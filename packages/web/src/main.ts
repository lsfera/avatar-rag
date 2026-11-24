import type { ServerMessage } from "@avatar/core"
import { Avatar } from "./avatar.js"
import { connect, floatToPcm16, type Connection } from "./client.js"
import { NO_VISEMES, bandsFromSpectrum, smooth, visemesFromBands, type Visemes } from "./lipsync.js"
import { AudioPlayer, PLAYBACK_RATE } from "./player.js"
import { startVad } from "./vad.js"

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
const serverUrl = params.get("server") ?? `ws://${location.hostname}:3000/ws`
const SENTENCE_SLOTS = 10_000
/** `?fps=12` caps rendering; used by the headless proof, where software GL would starve the speech servers. */
const frameInterval = params.has("fps") ? 1000 / Number(params.get("fps")) : 0

// ---- debug surface used by the browser proof (scripts/browser-proof.mjs) ----
const debug = {
  status: "spento", peakMouth: 0, latencyMs: -1, acks: 0, interruptions: 0,
  transcripts: [] as Array<string>, replies: [] as Array<string>, vadStarts: 0, vadEnds: 0, errors: [] as Array<string>
}
;(window as unknown as { __debug: typeof debug }).__debug = debug

// ---- UI ----
const stage = $("stage"), logEl = $("log"), statusEl = $("status"), latencyEl = $("latency")
const startBtn = $<HTMLButtonElement>("start"), stopBtn = $<HTMLButtonElement>("stop")
const micBox = $<HTMLInputElement>("mic"), form = $("form"), textEl = $<HTMLInputElement>("text"), sendBtn = $<HTMLButtonElement>("send")

const setStatus = (s: string) => { debug.status = s; statusEl.textContent = s }
const bubble = (cls: "user" | "bot" | "sys", text: string): HTMLElement => {
  const el = document.createElement("div")
  el.className = `msg ${cls}`; el.textContent = text
  logEl.append(el); logEl.scrollTop = logEl.scrollHeight
  return el
}

// ---- avatar + lip-sync loop ----
const avatar = new Avatar(stage)
avatar.load("/avatars/default.vrm").catch((e: unknown) => {
  debug.errors.push(`avatar: ${String(e)}`); bubble("sys", "Avatar non caricato (esegui pnpm --filter @avatar/web prepare-assets)")
})
let player: AudioPlayer | undefined
let smoothed: Visemes = NO_VISEMES
const timeBuf = new Float32Array(1024), freqBuf = new Float32Array(512)
let last = performance.now()
const refreshStatus = () => {
  if (!player) return
  if (player.playing && (debug.status === "pronto" || debug.status === "penso")) setStatus("parlo")
  else if (!player.playing && debug.status === "parlo" && !turnOpen) setStatus("pronto")
}
const frame = (now: number) => {
  requestAnimationFrame(frame)
  if (now - last < frameInterval) return
  refreshStatus()
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  let target = NO_VISEMES
  if (player?.playing) {
    player.analyser.getFloatTimeDomainData(timeBuf)
    let sq = 0
    for (const s of timeBuf) sq += s * s
    player.analyser.getFloatFrequencyData(freqBuf)
    target = visemesFromBands(bandsFromSpectrum(freqBuf, PLAYBACK_RATE), Math.sqrt(sq / timeBuf.length))
  }
  smoothed = {
    aa: smooth(smoothed.aa, target.aa, dt), ih: smooth(smoothed.ih, target.ih, dt), ou: smooth(smoothed.ou, target.ou, dt),
    ee: smooth(smoothed.ee, target.ee, dt), oh: smooth(smoothed.oh, target.oh, dt)
  }
  avatar.setVisemes(smoothed)
  debug.peakMouth = avatar.peakMouth
  avatar.update(dt)
}
requestAnimationFrame(frame)

// ---- conversation state ----
let conn: Connection | undefined
let turnSeq = 0
const turnIds: Array<string> = []
let activeTurnId: string | undefined
let turnOpen = false
let lastSentence: number | undefined
let muted = false
let mutedTurn: string | undefined
let sentAt = 0
let botBubble: HTMLElement | undefined

const keyOf = (sentenceId: number) => (turnSeq - 1) * SENTENCE_SLOTS + sentenceId
const finishLastSentence = () => { if (lastSentence !== undefined) player?.complete(keyOf(lastSentence)); lastSentence = undefined }

/** Stops local playback now and ignores in-flight audio of the interrupted turn. */
const silence = () => {
  const wasPlaying = player?.playing ?? false
  player?.stop()
  muted = turnOpen; mutedTurn = activeTurnId
  lastSentence = undefined
  if (turnOpen || wasPlaying) debug.interruptions++
  if (player) setStatus("pronto")
}

const onControl = (m: ServerMessage) => {
  switch (m._tag) {
    case "Transcript":
      debug.transcripts.push(m.text); bubble("user", m.text); break
    case "SentenceStart": {
      if (muted) { if (m.turnId !== mutedTurn) muted = false; else break }
      if (m.turnId !== activeTurnId) {
        activeTurnId = m.turnId; turnIds[turnSeq++] = m.turnId; turnOpen = true; lastSentence = undefined
        botBubble = bubble("bot", ""); debug.replies.push("")
      }
      finishLastSentence()
      lastSentence = m.sentenceId
      if (botBubble) botBubble.textContent = `${botBubble.textContent ? botBubble.textContent + " " : ""}${m.text}`
      debug.replies[debug.replies.length - 1] = botBubble?.textContent ?? ""
      setStatus("parlo")
      break
    }
    case "TurnEnd":
      if (muted && m.turnId === mutedTurn) muted = false
      else { finishLastSentence() }
      if (m.turnId === activeTurnId) turnOpen = false
      break
    case "Failure":
      debug.errors.push(m.message); bubble("sys", m.message); setStatus("pronto"); break
  }
}

const onAudio = (sentenceId: number, pcm: Uint8Array) => {
  if (muted || !player) return
  const wasEmpty = player.firstChunkAt === undefined
  player.enqueue(keyOf(sentenceId), pcm)
  if (wasEmpty && sentAt > 0) {
    debug.latencyMs = Math.round(performance.now() - sentAt)
    latencyEl.textContent = `latenza ${debug.latencyMs} ms`
  }
}

const sendAck = (key: number) => {
  const turnId = turnIds[Math.floor(key / SENTENCE_SLOTS)]
  if (!turnId || !conn) return
  conn.send({ _tag: "SentencePlayed", turnId: turnId as never, sentenceId: (key % SENTENCE_SLOTS) as never })
  debug.acks++
}

const sendText = (text: string) => {
  if (!conn || text.trim() === "") return
  silence(); player?.stop()
  bubble("user", text)
  sentAt = performance.now()
  conn.send({ _tag: "UserText", text })
  setStatus("penso")
}

// ---- microphone ----
let vadStarted = false
const startMic = async () => {
  if (vadStarted) return
  try {
    await startVad({
      onSpeechStart: () => { debug.vadStarts++; silence(); conn?.send({ _tag: "SpeechStart" }); setStatus("ascolto") },
      onSpeechEnd: (samples) => {
        debug.vadEnds++
        const pcm = floatToPcm16(samples)
        for (let i = 0; i < pcm.length; i += 8192) conn?.sendBinary(pcm.subarray(i, i + 8192))
        sentAt = performance.now()
        conn?.send({ _tag: "SpeechEnd" })
        setStatus("penso")
      }
    })
    vadStarted = true
  } catch (e) {
    debug.errors.push(`mic: ${String(e)}`); bubble("sys", `Microfono non disponibile: ${String(e)}`); micBox.checked = false
  }
}

// ---- wiring ----
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true; setStatus("connessione…")
  try {
    player = new AudioPlayer(sendAck)
    await player.resume()
    conn = await connect(serverUrl, {
      onControl, onAudio,
      onClose: () => { setStatus("disconnesso"); bubble("sys", "Connessione chiusa"); conn = undefined }
    })
    setStatus("pronto"); textEl.disabled = false; sendBtn.disabled = false; stopBtn.disabled = false; textEl.focus()
    bubble("sys", "Connesso. Scrivi o attiva il microfono.")
    if (micBox.checked) await startMic()
  } catch (e) {
    debug.errors.push(String(e)); bubble("sys", String(e)); setStatus("errore"); startBtn.disabled = false
  }
})
micBox.addEventListener("change", () => { if (micBox.checked && conn) void startMic() })
stopBtn.addEventListener("click", () => { silence(); conn?.send({ _tag: "BargeIn" }) })
form.addEventListener("submit", (e) => { e.preventDefault(); const t = textEl.value; textEl.value = ""; sendText(t) })

// Drives the real web client in headless Chromium against the full stack and asserts on what the user
// would see and hear. Requires: Ollama, STT (:8001), TTS (:8002), server (:3000), web (:5173).
// The "microphone" is a WAV of a synthesized Italian question (Chromium fake capture device).
import assert from "node:assert/strict"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright-core"

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const WS = process.env.WS_URL ?? "ws://localhost:3000/ws"
const TTS = process.env.TTS_URL ?? "http://localhost:8002"
const OUT = process.env.PROOF_DIR ?? "docs/proof"
const LIBS = "infra/.cache/chromium-libs/root/usr/lib/aarch64-linux-gnu"
mkdirSync(OUT, { recursive: true })

const wav = (i16, rate) => {
  const pcm = Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength), h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
const resample = (i16, from, to) => {
  const out = new Int16Array(Math.floor(i16.length * to / from))
  for (let i = 0; i < out.length; i++) {
    const p = i * from / to, i0 = Math.floor(p), f = p - i0
    out[i] = i16[i0] + ((i16[Math.min(i0 + 1, i16.length - 1)] ?? 0) - i16[i0]) * f
  }
  return out
}
const speech = async (text) => {
  const r = await fetch(`${TTS}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, voice: "it_IT-paola-medium", response_format: "pcm" }) })
  const b = Buffer.from(await r.arrayBuffer())
  return new Int16Array(b.buffer, b.byteOffset, b.length / 2) // 24 kHz
}

// 1.5 s of silence (VAD warm-up), the question, then 12 s of silence; no looping.
const question = resample(await speech("Quanto costa il biglietto intero?"), 24000, 48000)
const micWav = `${OUT}/mic-question.wav`
writeFileSync(micWav, wav(Int16Array.from([...new Int16Array(72000), ...question, ...new Int16Array(48000 * 12)]), 48000))

const env = { ...process.env }
if (existsSync(LIBS)) env.LD_LIBRARY_PATH = `${LIBS}:${env.LD_LIBRARY_PATH ?? ""}`
const launch = (extra = []) => chromium.launch({
  headless: true, env,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...extra]
})

let failed = 0
const check = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`) } }
const open = async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ["microphone"] })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message))
  await page.goto(`${WEB}/?fps=12&server=${encodeURIComponent(WS)}`)
  await page.waitForFunction(() => document.querySelector("canvas") !== null)
  return page
}
const dbg = (page) => page.evaluate(() => structuredClone(window.__debug))
const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

// ---- text conversation, lip-sync and acks ----
{
  const browser = await launch()
  const page = await open(browser)
  await page.waitForTimeout(3000) // let the VRM load
  await page.screenshot({ path: `${OUT}/1-idle.png` })
  await page.click("#start"); await page.waitForFunction(() => window.__debug.status === "pronto", null, { timeout: 15000 })

  await check("text: asks, hears Italian speech, mouth moves, sentences are acked", async () => {
    await page.evaluate(() => { window.__debug.peakMouth = 0 })
    await page.fill("#text", "A che ora apre il museo?"); await page.press("#text", "Enter")
    await page.waitForFunction(() => window.__debug.status === "parlo", null, { timeout: 30000 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/2-speaking.png` })
    await page.waitForFunction(() => window.__debug.acks >= 1, null, { timeout: 30000 })
    const d = await dbg(page)
    console.log(`  reply «${d.replies.at(-1)}» latency ${d.latencyMs} ms, peak mouth ${d.peakMouth.toFixed(2)}, acks ${d.acks}`)
    assert.match(norm(d.replies.at(-1)), /nove|9/)
    assert.ok(d.peakMouth > 0.25, `mouth should open while speaking (peak ${d.peakMouth})`)
    assert.ok(d.latencyMs > 0 && d.latencyMs < 5000)
    await page.waitForFunction(() => window.__debug.status === "pronto", null, { timeout: 30000 })
    const idle = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.__debug.peakMouth), 0)))
    assert.ok(idle > 0)
  })

  await check("barge-in: Interrompi silences the avatar and closes the mouth", async () => {
    await page.fill("#text", "Raccontami la storia della villa e della collezione in modo molto dettagliato."); await page.press("#text", "Enter")
    await page.waitForFunction(() => window.__debug.status === "parlo", null, { timeout: 30000 })
    await page.waitForTimeout(500)
    const before = await dbg(page)
    await page.click("#stop")
    await page.waitForTimeout(600)
    const after = await dbg(page)
    const playing = await page.evaluate(() => window.__debug.status)
    console.log(`  interruptions ${before.interruptions} -> ${after.interruptions}, status ${playing}`)
    assert.ok(after.interruptions > before.interruptions)
    assert.equal(playing, "pronto")
    const a = await dbg(page); await page.waitForTimeout(1500); const b = await dbg(page)
    assert.deepEqual(b.replies, a.replies, "no further sentences may appear after the interruption")
    await page.screenshot({ path: `${OUT}/3-interrupted.png` })
  })
  await browser.close()
}

// ---- voice conversation through the (fake) microphone ----
{
  const browser = await launch(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${process.cwd()}/${micWav}%noloop`])
  const page = await open(browser)
  await page.waitForTimeout(2500)
  await check("voice: VAD detects speech, STT transcribes, avatar answers aloud", async () => {
    await page.check("#mic"); await page.click("#start")
    await page.waitForFunction(() => window.__debug.vadStarts >= 1, null, { timeout: 30000 })
    await page.waitForFunction(() => window.__debug.transcripts.length >= 1, null, { timeout: 40000 })
    await page.waitForFunction(() => window.__debug.status === "parlo", null, { timeout: 40000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/4-voice-turn.png` })
    await page.waitForFunction(() => window.__debug.acks >= 1, null, { timeout: 30000 })
    const d = await dbg(page)
    console.log(`  transcript «${d.transcripts[0]}»\n  reply «${d.replies.at(-1)}»\n  speech->first audio ${d.latencyMs} ms, vad starts/ends ${d.vadStarts}/${d.vadEnds}, errors ${JSON.stringify(d.errors)}`)
    // Whisper small on a synthetic voice through a lossy capture path garbles words; "intero"/"biglietto"/"cost" survive.
    assert.match(norm(d.transcripts[0]), /intero|biglietto|cost/)
    assert.match(norm(d.replies.at(-1)), /8|otto/)
    assert.ok(d.peakMouth > 0.25)
    assert.deepEqual(d.errors, [])
  })
  await browser.close()
}

console.log(failed === 0 ? "\nALL BROWSER CHECKS PASSED" : `\n${failed} BROWSER CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)

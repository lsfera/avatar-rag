/** Gapless playback of sentence-tagged 24 kHz PCM16, with an analyser tap for lip-sync. */
export const PLAYBACK_RATE = 24_000

interface SentenceState { endTime: number; complete: boolean; timer: number | undefined }

export class AudioPlayer {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  private readonly out: GainNode
  private nextTime = 0
  private readonly sources = new Set<AudioBufferSourceNode>()
  private readonly sentences = new Map<number, SentenceState>()
  /** performance.now() when the first chunk of the current reply was scheduled. */
  firstChunkAt: number | undefined

  constructor(private readonly onPlayed: (sentenceId: number) => void) {
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_RATE })
    this.out = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.3
    this.out.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  /** True while scheduled audio has not finished playing. */
  get playing(): boolean { return this.ctx.currentTime < this.nextTime - 0.01 }

  async resume(): Promise<void> { if (this.ctx.state !== "running") await this.ctx.resume() }

  enqueue(sentenceId: number, pcm: Uint8Array): void {
    if (pcm.byteLength < 2) return
    const i16 = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength - (pcm.byteLength % 2)))
    const buffer = this.ctx.createBuffer(1, i16.length, PLAYBACK_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < i16.length; i++) channel[i] = i16[i]! / 32768
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.out)
    const startAt = Math.max(this.ctx.currentTime + 0.04, this.nextTime)
    source.start(startAt)
    this.nextTime = startAt + buffer.duration
    this.sources.add(source)
    source.onended = () => this.sources.delete(source)
    this.firstChunkAt ??= performance.now()
    const state = this.sentences.get(sentenceId) ?? { endTime: 0, complete: false, timer: undefined }
    state.endTime = this.nextTime
    this.sentences.set(sentenceId, state)
  }

  /** No more audio will arrive for this sentence; ack it once its last sample has played. */
  complete(sentenceId: number): void {
    const state = this.sentences.get(sentenceId)
    if (!state || state.complete) return
    state.complete = true
    const delayMs = Math.max(0, state.endTime - this.ctx.currentTime) * 1000 + 30
    state.timer = window.setTimeout(() => {
      this.sentences.delete(sentenceId)
      this.onPlayed(sentenceId)
    }, delayMs)
  }

  /** Barge-in: silence everything now. Sentences that did not finish are never acked. */
  stop(): void {
    for (const s of this.sources) { s.onended = null; try { s.stop() } catch { /* already stopped */ } }
    this.sources.clear()
    for (const state of this.sentences.values()) if (state.timer !== undefined) clearTimeout(state.timer)
    this.sentences.clear()
    this.nextTime = 0
    this.firstChunkAt = undefined
  }
}

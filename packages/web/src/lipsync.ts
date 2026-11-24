/** Energy in four speech bands (linear power), roughly: F0/F1 low, F1, F2, F2-high/fricatives. */
export interface Bands { readonly low: number; readonly mid1: number; readonly mid2: number; readonly high: number }
export interface Visemes { readonly aa: number; readonly ih: number; readonly ou: number; readonly ee: number; readonly oh: number }
export const NO_VISEMES: Visemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/**
 * Maps band energies of the audio being played to VRM vowel shapes. Language-agnostic
 * (ADR 0003): the loudness sets how open the mouth is, the spectral balance picks the vowel.
 * `level` is RMS in 0..1; below `gate` the mouth is closed.
 */
export const visemesFromBands = (bands: Bands, level: number, opts: { gate?: number; gain?: number } = {}): Visemes => {
  const gate = opts.gate ?? 0.01
  if (level < gate) return NO_VISEMES
  const total = bands.low + bands.mid1 + bands.mid2 + bands.high
  if (total <= 0) return NO_VISEMES
  const p = { low: bands.low / total, mid1: bands.mid1 / total, mid2: bands.mid2 / total, high: bands.high / total }
  const raw = {
    aa: Math.max(0, p.mid1 * 1.6 - p.low * 0.2),
    oh: Math.max(0, p.low * 0.9 + p.mid1 * 0.6 - p.mid2 * 0.5),
    ou: Math.max(0, p.low * 1.2 - p.mid1 * 0.3 - p.mid2 * 0.8 - p.high),
    ee: Math.max(0, p.high * 0.9 + p.mid2 * 0.7 - p.mid1 * 0.4),
    ih: Math.max(0, p.mid2 * 1.1 + p.high * 0.4 - p.mid1 * 0.5)
  }
  const sum = raw.aa + raw.oh + raw.ou + raw.ee + raw.ih
  if (sum <= 0) return { ...NO_VISEMES, aa: clamp01(level * (opts.gain ?? 6)) * 0.4 }
  const openness = clamp01((level - gate) * (opts.gain ?? 6))
  return {
    aa: openness * raw.aa / sum, oh: openness * raw.oh / sum, ou: openness * raw.ou / sum,
    ee: openness * raw.ee / sum, ih: openness * raw.ih / sum
  }
}

/** Exponential smoothing with a fast attack and slower release, so the mouth doesn't flicker. */
export const smooth = (prev: number, next: number, dtSeconds: number, attack = 0.04, release = 0.09): number => {
  const tau = next > prev ? attack : release
  return prev + (next - prev) * (1 - Math.exp(-dtSeconds / tau))
}

/** Band energies from an analyser's float dB spectrum. */
export const bandsFromSpectrum = (dbSpectrum: Float32Array, sampleRate: number): Bands => {
  const binHz = sampleRate / 2 / dbSpectrum.length
  const sum = (lo: number, hi: number): number => {
    let s = 0
    for (let i = Math.max(0, Math.floor(lo / binHz)); i < Math.min(dbSpectrum.length, Math.ceil(hi / binHz)); i++) {
      s += Math.pow(10, (dbSpectrum[i] ?? -140) / 10)
    }
    return s
  }
  return { low: sum(150, 450), mid1: sum(450, 900), mid2: sum(900, 1800), high: sum(1800, 3500) }
}

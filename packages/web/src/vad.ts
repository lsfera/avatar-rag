import { MicVAD } from "@ricky0123/vad-web"

export interface VadHandlers {
  readonly onSpeechStart: () => void
  /** 16 kHz mono Float32 samples of the whole Utterance. */
  readonly onSpeechEnd: (samples: Float32Array) => void
}

/** Silero VAD on the microphone, assets served from /vad (see scripts/prepare-assets.mjs). */
export const startVad = async (handlers: VadHandlers): Promise<MicVAD> => {
  const vad = await MicVAD.new({
    model: "v5",
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    ortConfig: (ort) => { ort.env.wasm.numThreads = 1 },
    redemptionMs: 700,
    minSpeechMs: 250,
    onSpeechRealStart: handlers.onSpeechStart,
    onSpeechEnd: handlers.onSpeechEnd
  })
  await vad.start()
  return vad
}

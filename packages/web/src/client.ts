import { decodeAudioFrame, type ClientMessage, type ServerMessage } from "@avatar/core"

export interface Handlers {
  readonly onControl: (message: ServerMessage) => void
  readonly onAudio: (sentenceId: number, pcm: Uint8Array) => void
  readonly onClose: () => void
}

export interface Connection {
  readonly send: (message: ClientMessage) => void
  readonly sendBinary: (data: Uint8Array) => void
  readonly close: () => void
}

export const connect = (url: string, handlers: Handlers): Promise<Connection> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`))
    ws.onclose = () => handlers.onClose()
    ws.onmessage = (event) => {
      if (typeof event.data === "string") handlers.onControl(JSON.parse(event.data) as ServerMessage)
      else {
        const { sentenceId, pcm } = decodeAudioFrame(new Uint8Array(event.data as ArrayBuffer))
        handlers.onAudio(sentenceId, pcm)
      }
    }
    ws.onopen = () => resolve({
      send: (m) => ws.send(JSON.stringify(m)),
      sendBinary: (data) => ws.send(data as BufferSource),
      close: () => ws.close()
    })
  })

/** Float32 [-1, 1] mono samples -> little-endian PCM16 bytes. */
export const floatToPcm16 = (samples: Float32Array): Uint8Array => {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767)
  return new Uint8Array(out.buffer)
}

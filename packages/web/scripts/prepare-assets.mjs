// Copies VAD model/worklet/wasm assets into public/vad and fetches the sample avatar.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const vadDir = join(root, "node_modules/@ricky0123/vad-web/dist")
const ortDir = join(root, "node_modules/onnxruntime-web/dist")
const out = join(root, "public", "vad")
mkdirSync(out, { recursive: true })
for (const f of ["silero_vad_v5.onnx", "silero_vad_legacy.onnx", "vad.worklet.bundle.min.js"]) copyFileSync(join(vadDir, f), join(out, f))
for (const f of readdirSync(ortDir).filter((n) => /^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(n))) copyFileSync(join(ortDir, f), join(out, f))

// VRM 1.0 sample by pixiv: avatarPermission=everyone, redistribution and modification allowed, no credit needed
// (license embedded in the file: https://vrm.dev/licenses/1.0/). Not committed: 10 MB.
const avatar = join(root, "public", "avatars", "default.vrm")
if (!existsSync(avatar)) {
  mkdirSync(dirname(avatar), { recursive: true })
  const url = "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"
  const res = await fetch(url)
  if (!res.ok) throw new Error(`avatar download failed: ${res.status}`)
  writeFileSync(avatar, Buffer.from(await res.arrayBuffer()))
  console.log("downloaded sample avatar")
}

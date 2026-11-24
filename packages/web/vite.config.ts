import { createReadStream, existsSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"

const here = dirname(fileURLToPath(import.meta.url))
const TYPES: Record<string, string> = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream" }

/**
 * onnxruntime-web dynamically imports its wasm loader (.mjs) from /vad. Vite's dev server rewrites that
 * import with `?import` and rejects files under /public, so serve /vad untouched, before Vite's own middleware.
 */
const vadAssets = (): Plugin => ({
  name: "vad-assets",
  configureServer(server) {
    server.middlewares.use("/vad", (req, res, next) => {
      const file = join(here, "public", "vad", new URL(req.url ?? "/", "http://localhost").pathname)
      if (!existsSync(file)) return next()
      res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream")
      createReadStream(file).pipe(res)
    })
  }
})

export default defineConfig({
  plugins: [vadAssets()],
  server: { fs: { allow: ["../.."] } },
  build: { target: "es2022" }
})

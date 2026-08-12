import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { rm } from "node:fs/promises"
import path from "node:path"

const directory = path.resolve(process.argv[2] ?? ".")
await rm(path.join(directory, "dist"), { recursive: true, force: true })
const tsx = path.join(directory, "src/index.tsx")
const result = await Bun.build({
  entrypoints: [(await Bun.file(tsx).exists()) ? tsx : path.join(directory, "src/index.ts")],
  outdir: path.join(directory, "dist"),
  target: "bun",
  format: "esm",
  plugins: [createSolidTransformPlugin()],
  external: ["@opencode-ai/plugin/tui", "@opentui/core", "@opentui/core-*", "@opentui/keymap"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

import { test } from "bun:test"
import { strict as assert } from "node:assert"
import path from "node:path"

test("polls CI only for the active mounted session and stops on disposal", async () => {
  // Isolate Solid's client runtime, module mocks, and clock from the other tests.
  const proc = Bun.spawn([
    process.execPath, "--preload", "@opentui/solid/preload",
    path.join(import.meta.dir, "polling.fixture.ts"),
  ], { cwd: path.join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
  assert.equal(exit, 0, stdout + stderr)
})

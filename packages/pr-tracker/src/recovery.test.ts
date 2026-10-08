import { test } from "bun:test"
import { strict as assert } from "node:assert"
import path from "node:path"
import { createHistoryReader } from "./history"

test("recovers a descendant's historical MR with empty TUI caches", async () => {
  const proc = Bun.spawn([
    process.execPath, "--preload", "@opentui/solid/preload",
    path.join(import.meta.dir, "recovery.fixture.ts"),
  ], { cwd: path.join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
  assert.equal(exit, 0, stdout + stderr)
})

type Client = Parameters<typeof createHistoryReader>[0]
const url = "https://code.example.com/acme/widget/-/merge_requests/42"
const shell = (output: string, exit = 0) => ({
  type: "shell", status: "exited", exit, command: "glab mr create", output: { output },
})

test("refreshes family metadata but reuses completed unchanged transcripts", async () => {
  const root = { id: "root", location: { directory: "/example/root" }, time: { updated: 1 } }
  const child = { id: "child", parentID: "root", location: { directory: "/example/child" }, time: { updated: 2 } }
  const sessions: Awaited<ReturnType<Client["session"]["get"]>>[] = [root, child]
  const reads: string[] = []
  const client: Client = {
    session: {
      get: async ({ sessionID }) => {
        const session = sessions.find((member) => member.id === sessionID)
        assert(session !== undefined)
        return session
      },
      list: async ({ parentID, cursor }) => ({
        data: cursor ? [] : sessions.filter((member) => member.parentID === parentID), cursor: { next: "end" },
      }),
    },
    message: {
      list: async ({ sessionID, cursor }) => {
        reads.push(sessionID)
        if (sessionID === "root" || cursor === "end") return { data: [], cursor: { next: "end" } }
        if (!cursor) return { data: [shell(`${url}1`, 1), shell(url)], cursor: { next: "older" } }
        return {
          data: [{ type: "assistant", content: [
            { type: "tool", state: { status: "error", input: { command: "glab mr create" }, content: [{ type: "text", text: `${url}0` }] } },
            { type: "tool", state: { status: "completed", input: { command: "glab mr create" }, content: [{ type: "text", text: url }] } },
          ] }], cursor: { next: "end" },
        }
      },
    },
  }
  const reader = createHistoryReader(client)
  const signal = new AbortController().signal
  const expected = {
    rootID: "root", members: [
      { id: "root", directory: "/example/root", references: [] },
      { id: "child", directory: "/example/child", references: [{ provider: "gitlab", value: url }] },
    ],
  } satisfies Awaited<ReturnType<typeof reader.recover>>
  assert.deepEqual(await reader.recover("child", signal), expected)
  assert.equal(reads.length, 4, "finish populated pages with next cursors by reading their empty successor")
  reads.length = 0
  assert.deepEqual(await reader.recover("root", signal), expected)
  assert.deepEqual(reads, [], "periodic discovery must not download unchanged transcripts")

  child.time.updated++
  child.location.directory = "/example/moved-child"
  const recovered = await reader.recover("root", signal)
  assert.equal(recovered.members[1]?.directory, "/example/moved-child")
  assert.deepEqual(reads, ["child", "child", "child"], "only the changed member needs its history read again")
})

for (const interrupted of ["failed", "cancelled"] as const) {
  test(`retries a ${interrupted} transcript instead of caching a partial result`, async () => {
    const session = { id: "root", location: { directory: "/example/root" }, time: { updated: 1 } }
    let controller = new AbortController()
    let interrupt = true
    let firstPages = 0
    const client: Client = {
      session: { get: async () => session, list: async () => ({ data: [], cursor: {} }) },
      message: {
        list: async ({ cursor }, options) => {
          assert.equal(options.signal, controller.signal)
          if (!cursor) {
            firstPages++
            return { data: [shell(url)], cursor: { next: "older" } }
          }
          if (interrupt) {
            if (interrupted === "failed") throw new Error("page unavailable")
            controller.abort()
            // Even a transport that resolves after abort must not populate the cache.
            return { data: [], cursor: {} }
          }
          return { data: [shell(`${url}0`)], cursor: {} }
        },
      },
    }
    const reader = createHistoryReader(client)
    await assert.rejects(reader.recover("root", controller.signal))
    interrupt = false
    controller = new AbortController()
    const recovered = await reader.recover("root", controller.signal)
    assert.deepEqual(recovered.members[0]?.references, [
      { provider: "gitlab", value: url }, { provider: "gitlab", value: `${url}0` },
    ])
    assert.equal(firstPages, 2, "retry all pages after an incomplete read")
  })
}

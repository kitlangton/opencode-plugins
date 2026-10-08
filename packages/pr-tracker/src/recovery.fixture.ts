import { mock } from "bun:test"
import { strict as assert } from "node:assert"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Reference } from "./reference"
import type { Pr } from "./request"

const pr: Pr = {
  provider: "gitlab", number: 42, url: "https://code.example.com/acme/widget/-/merge_requests/42",
  title: "Recovered child change", state: "OPEN", isDraft: false, statusCheckRollup: [],
}
mock.module("./request", () => ({
  fetchPr: async (directory: string, reference?: string | Reference) => {
    const value = typeof reference === "string" ? reference : reference?.value
    return directory === "/example/child" && value === pr.url ? pr : undefined
  },
}))
const { default: plugin } = await import("./index")
const [store, setStore] = createStore({ roots: {} as Record<string, string[]>, prs: {} as Record<string, Pr> })
const metadata = [
  { id: "root", location: { directory: "/example/root" }, time: { updated: 1 } },
  { id: "child", parentID: "root", location: { directory: "/example/child" }, time: { updated: 2 } },
  { id: "sibling", parentID: "root", location: { directory: "/example/sibling" }, time: { updated: 3 } },
  { id: "grandchild", parentID: "child", location: { directory: "/example/child" }, time: { updated: 4 } },
]
type Sidebar = (props: { sessionID: string }) => ReturnType<Parameters<Plugin.Context["ui"]["slot"]>[0]["render"]>
let sidebar: Sidebar | undefined
const context = {
  location: { directory: "/example/root" },
  storage: { memory: () => [store, (mutate: (draft: typeof store) => void) => setStore(produce(mutate))] },
  client: {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = metadata.find((member) => member.id === sessionID)
        assert(session !== undefined)
        return session
      },
      list: async ({ parentID, cursor, order }: { parentID: string; cursor?: string; order?: string }) => {
        assert(!(cursor && order), "cursor pages must not also set order")
        const children = metadata.filter((member) => member.parentID === parentID)
        const index = cursor ? Number(cursor) : 0
        // The server can provide a next cursor on its last populated page.
        return { data: children.slice(index, index + 1), cursor: { next: String(index + 1) } }
      },
    },
    message: {
      list: async ({ sessionID, cursor, order }: { sessionID: string; cursor?: string; order?: string }) => {
        assert(!(cursor && order), "cursor pages must not also set order")
        if (sessionID !== "grandchild" || cursor === "end") return { data: [], cursor: { next: "end" } }
        if (!cursor) return {
          data: Array.from({ length: 20 }, (_, index) => ({ type: "user", id: `recent-${index}` })),
          cursor: { next: "older" },
        }
        return {
          data: [{ type: "assistant", content: [{ type: "tool", state: {
            status: "completed", input: { command: "glab mr create --title 'Recovered child change'" },
            content: [{ type: "text", text: pr.url }],
          } }] }],
          cursor: { next: "end" },
        }
      },
    },
  },
  data: {
    on: () => () => {},
    session: {
      root: (id: string) => id,
      get: () => undefined,
      family: () => [],
      sync: async () => {},
      message: { list: () => [], get: () => undefined, sync: async () => {} },
    },
  },
  ui: {
    router: { current: () => ({ type: "session", sessionID: "root" }) },
    slot: (claim: Parameters<Plugin.Context["ui"]["slot"]>[0]) => {
      assert.equal(claim.append, "sidebar.content")
      sidebar = claim.render
    },
  },
  theme: {
    text: { default: "#ffffff", subdued: "#aaaaaa" },
    background: { action: { primary: { hovered: "#333333" } } },
  },
} as unknown as Plugin.Context

const unload = await plugin.setup(context)
assert(sidebar !== undefined)
const renderSidebar = sidebar
const view = await testRender(() => renderSidebar({ sessionID: "root" }), { width: 60, height: 8 })
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    await Bun.sleep(10)
    await view.renderOnce()
    if (view.captureCharFrame().includes(pr.title)) break
  }
  assert.match(view.captureCharFrame(), /Merge requests/, "recover persisted history instead of reading the empty TUI cache once")
  assert.match(view.captureCharFrame(), /●.*!42 Recovered child change/)
} finally {
  view.renderer.destroy()
  if (typeof unload === "function") unload()
}

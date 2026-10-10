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
const rootPr: Pr = {
  ...pr, number: 41, url: "https://code.example.com/acme/widget/-/merge_requests/41",
  title: "Created from a description", statusCheckRollup: [{ status: "IN_PROGRESS" }],
}
const closedPr: Pr = {
  ...pr, number: 43, url: "https://code.example.com/acme/widget/-/merge_requests/43",
  title: "Already merged", state: "MERGED",
}
const quotedOnly = process.argv[2] === "quoted"
const { mrReference } = await import("./request")
mock.module("./request", () => ({
  mrReference,
  fetchPr: async (directory: string, reference?: string | Reference) => {
    const value = typeof reference === "string" ? reference : reference?.value
    if (directory === "/example/root" && value === rootPr.url) return rootPr
    if (directory === "/example/child" && value === closedPr.url) return closedPr
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
  storage: {
    memory: () => [store, (mutate: (draft: typeof store) => void) => setStore(produce(mutate))],
    store: () => [{ roots: {} }, async () => {}],
  },
  keymap: { layer: () => {} },
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
        if (sessionID === "root" && !cursor) return {
          data: [{ type: "shell", status: "exited", exit: 0,
            command: "glab mr create --title 'Created from a description' --description \"$(cat <<'EOF'\nDetails with $text, `examples`, quotes \"like this\" and (parentheses).\nEOF\n)\" --yes",
            output: { output: rootPr.url },
          }], cursor: {},
        }
        if (sessionID !== "grandchild" || cursor === "end") return { data: [], cursor: { next: "end" } }
        if (!cursor) return {
          data: Array.from({ length: 20 }, (_, index) => ({ type: "user", id: `recent-${index}` })),
          cursor: { next: "older" },
        }
        return {
          data: [{ type: "assistant", content: [
            { type: "tool", state: {
              status: "completed", input: { command: quotedOnly
                ? "glab mr create --title 'Recovered child change' --description $'Details with \\'quotes\\' and \\nlines' --yes"
                : "glab api projects/2/merge_requests/42 --method PUT -f description='Updated child change' | jq '{iid,web_url}'" },
              content: [{ type: "text", text: quotedOnly ? pr.url : JSON.stringify({ iid: 42, web_url: pr.url }) }],
            } },
            { type: "tool", state: {
              status: "completed", input: { command: "glab api projects/2/merge_requests/42 --method PUT -f description='Another update'" },
              content: [{ type: "text", text: JSON.stringify({ iid: 42, web_url: pr.url }) }],
            } },
            { type: "tool", state: {
              status: "completed", input: { command: "glab mr create --title 'Already merged'" },
              content: [{ type: "text", text: closedPr.url }],
            } },
          ] }],
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
    if ([pr.title, rootPr.title].every((title) => view.captureCharFrame().includes(title))) break
  }
  assert.match(view.captureCharFrame(), /Merge requests/, "recover persisted history instead of reading the empty TUI cache once")
  assert.match(view.captureCharFrame(), /●.*!42 Recovered child change/)
  assert.match(view.captureCharFrame(), /◌.*!41 Created from a description/)
  assert.equal(view.captureCharFrame().match(/!42 /g)?.length, 1, "repeated update results must not duplicate a row")
  assert(!view.captureCharFrame().includes(closedPr.title), "merged requests must stay hidden")
} finally {
  view.renderer.destroy()
  if (typeof unload === "function") unload()
}

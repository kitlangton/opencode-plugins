import { mock, spyOn } from "bun:test"
import { strict as assert } from "node:assert"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Pr } from "./request"

const a: Pr = {
  provider: "gitlab", number: 1, url: "https://code.example.com/acme/widget/-/merge_requests/1",
  title: "Session A", state: "OPEN", isDraft: false, statusCheckRollup: [{ status: "IN_PROGRESS" }],
}
const b: Pr = { ...a, number: 2, url: a.url.replace(/1$/, "2"), title: "Session B" }
const [store, setStore] = createStore({ roots: { A: [a.url], B: [b.url] }, prs: { [a.url]: a, [b.url]: b } })
const lookups: (string | undefined)[] = []
let passed = false
const { mrReference } = await import("./request")
mock.module("./request", () => ({
  mrReference,
  fetchPr: async (_directory: string, url?: string) => {
    lookups.push(url)
    if (!url) return undefined
    const pr = url === a.url ? a : b
    return { ...pr, statusCheckRollup: passed ? [{ status: "COMPLETED", conclusion: "SUCCESS" }] : pr.statusCheckRollup }
  },
}))
const { default: plugin } = await import("./index")
const [route, setRoute] = createSignal<ReturnType<Plugin.Context["ui"]["router"]["current"]>>({ type: "session", sessionID: "A" })
type Sidebar = (props: { sessionID: string }) => ReturnType<Parameters<Plugin.Context["ui"]["slot"]>[0]["render"]>
let sidebar: Sidebar | undefined

// Supply the host APIs used by this plugin; rendering and reactive ownership stay real.
const context = {
  location: { directory: "/example/widget" },
  storage: {
    memory: () => [store, (mutate: (draft: typeof store) => void) => setStore(produce(mutate))],
    store: () => [{ roots: {} }, async () => {}],
  },
  keymap: { layer: () => {} },
  data: {
    on: () => () => {},
    session: { root: (id: string) => id, family: () => [], message: { list: () => [] } },
  },
  ui: {
    router: { current: route },
    slot: (claim: Parameters<Plugin.Context["ui"]["slot"]>[0]) => {
      assert(claim.append === "sidebar.content")
      sidebar = claim.render
    },
  },
  theme: {
    text: { default: "#ffffff", subdued: "#aaaaaa" },
    background: { action: { primary: { hovered: "#333333" } } },
  },
} as unknown as Plugin.Context

let now = 1_000_000
const intervals = new Map<ReturnType<typeof setInterval>, { run: () => void; next: number; period: number }>()
const nativeInterval = globalThis.setInterval
const nativeClear = globalThis.clearInterval
const date = spyOn(Date, "now").mockImplementation(() => now)
Object.defineProperty(globalThis, "setInterval", { value: (callback: (...args: unknown[]) => void, period?: number, ...args: unknown[]) => {
  if (period !== 45_000) return nativeInterval(callback, period, ...args)
  // Keep a real handle for type safety; the virtual clock owns polling callbacks.
  const handle = nativeInterval(() => {}, 2_147_483_647)
  handle.unref()
  intervals.set(handle, { run: () => callback(...args), next: now + period, period })
  return handle
} })
Object.defineProperty(globalThis, "clearInterval", { value: (handle?: ReturnType<typeof nativeInterval>) => {
  if (handle !== undefined) intervals.delete(handle)
  nativeClear(handle)
} })

const unload = await plugin.setup(context)
assert(sidebar !== undefined)
const renderSidebar = sidebar
const view = await testRender(() => [renderSidebar({ sessionID: "A" }), renderSidebar({ sessionID: "B" })], { width: 60, height: 12 })
async function advance(milliseconds: number) {
  const target = now + milliseconds
  while (true) {
    const next = [...intervals.values()].filter((timer) => timer.next <= target).sort((left, right) => left.next - right.next)[0]
    if (!next) break
    now = next.next
    next.next += next.period
    next.run()
    await Bun.sleep(0)
  }
  now = target
  await Bun.sleep(0)
  await view.renderOnce()
}

try {
  await advance(0)
  assert.match(view.captureCharFrame(), /◌.*!1 Session A/)
  lookups.length = 0
  passed = true
  await advance(30_000)
  setStore("prs", a.url, "title", "Session A updated")
  await advance(14_999)
  assert.equal(lookups.length, 0)
  await advance(1)
  assert(lookups.includes(undefined), "refresh the current branch")
  assert(lookups.includes(a.url), "refresh the active session's saved MR")
  assert(!lookups.includes(b.url), "do not poll a mounted background session")
  assert.match(view.captureCharFrame(), /●.*!1 Session A/)
  assert.equal(store.prs[a.url]?.statusCheckRollup[0]?.conclusion, "SUCCESS")

  lookups.length = 0
  setRoute({ type: "session", sessionID: "B" })
  await advance(45_000)
  assert(lookups.includes(b.url))
  assert(!lookups.includes(a.url))
  lookups.length = 0
  setRoute({ type: "home" })
  await advance(90_000)
  assert.equal(lookups.length, 0)

  setRoute({ type: "session", sessionID: "A" })
  view.renderer.destroy()
  await advance(45_000)
  assert.equal(lookups.length, 0, "disposing an active slot stops its polling")
  if (typeof unload === "function") unload()
  await advance(45_000)
  assert.equal(lookups.length, 0, "unloading does not restart polling")
} finally {
  view.renderer.destroy()
  if (typeof unload === "function") unload()
  for (const handle of intervals.keys()) nativeClear(handle)
  Object.defineProperty(globalThis, "clearInterval", { value: nativeClear })
  Object.defineProperty(globalThis, "setInterval", { value: nativeInterval })
  date.mockRestore()
}

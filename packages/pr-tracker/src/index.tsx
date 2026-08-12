/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode-ai/plugin/tui"

const POLL_MS = 45_000

const COLORS: Record<string, string> = {
  OPEN: "#a6da95",
  MERGED: "#c6a0f6",
  CLOSED: "#ed8796",
}

type Check = { status?: string; conclusion?: string }
type Pr = {
  number: number
  url: string
  state: string
  title: string
  isDraft: boolean
  mergedAt?: string
  statusCheckRollup: Check[]
}

async function run(cwd: string, ...command: string[]) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "ignore" })
  const stdout = await proc.stdout.text()
  return { code: await proc.exited, stdout: stdout.trim() }
}

async function fetchPr(directory: string, reference?: string): Promise<Pr | undefined> {
  const result = await run(
    directory,
    "gh",
    "pr",
    "view",
    ...(reference ? [reference] : []),
    "--json",
    "number,url,state,title,isDraft,mergedAt,statusCheckRollup",
  )
  if (result.code !== 0) return undefined
  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== "object" || parsed === null) return undefined
  const pr = parsed as Pr
  return typeof pr.number === "number" && typeof pr.url === "string" ? pr : undefined
}

function prUrls(command: unknown, output: unknown) {
  if (typeof command !== "string" || !/\bgh\s+pr\s+create\b/.test(command) || typeof output !== "string") return []
  return [...output.matchAll(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g)].map((match) => match[0])
}

function createdPrUrls(messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>) {
  const urls = new Set<string>()
  const adopt = (command: unknown, output: unknown) => prUrls(command, output).forEach((url) => urls.add(url))

  for (const message of messages) {
    if (message.type === "shell") {
      if (message.status === "exited" && message.exit === 0) adopt(message.command, message.output?.output)
      continue
    }
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      adopt(
        part.state.input.command,
        part.state.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n"),
      )
    }
  }
  return [...urls]
}

function checkStatus(pr: Pr) {
  const checks = (pr.statusCheckRollup ?? []).filter((check) => check.conclusion !== "SKIPPED")
  if (checks.some((check) => check.status && check.status !== "COMPLETED")) return "pending"
  if (
    checks.some((check) =>
      ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(
        check.conclusion ?? "",
      ),
    )
  )
    return "failed"
  return checks.length > 0 ? "passed" : "none"
}

function statusIcon(pr: Pr) {
  if (pr.isDraft) return "◇"
  if (pr.state === "MERGED") return "✓"
  if (pr.state === "CLOSED") return "×"
  const checks = checkStatus(pr)
  if (checks === "pending") return "◌"
  if (checks === "failed") return "×"
  return "●"
}

function statusColor(pr: Pr) {
  if (pr.isDraft) return "#8aadf4"
  if (pr.state === "MERGED") return COLORS.MERGED
  const checks = checkStatus(pr)
  if (pr.state === "CLOSED" || checks === "failed") return COLORS.CLOSED
  if (checks === "pending") return "#eed49f"
  return COLORS.OPEN
}

function changed(left: Pr | undefined, right: Pr | undefined) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

export default Plugin.define({
  id: "kit.pr-tracker",
  setup: async (context) => {
    const directory = context.location?.directory
    if (!directory) return
    const [state, update] = context.storage.memory("pr-sidebar-v2", {
      initial: {
        current: undefined as Pr | undefined,
        roots: {} as Record<string, string[]>,
        prs: {} as Record<string, Pr>,
      },
    })

    const recovered = new Set<string>()
    let activeRoot = ""
    let disposed = false
    let inFlight = false

    const adopt = async (sessionID: string, urls: string[]) => {
      if (disposed || urls.length === 0) return
      const root = context.data.session.root(sessionID)
      const previous = state.roots[root] ?? []
      const next = [...new Set([...previous, ...urls])]
      if (next.length !== previous.length)
        update((draft) => {
          draft.roots[root] = next
        })
      const missing = urls.filter((url) => !state.prs[url])
      const prs = (await Promise.all(missing.map((url) => fetchPr(directory, url)))).filter((pr) => pr !== undefined)
      if (disposed || prs.length === 0) return
      if (prs.some((pr) => changed(state.prs[pr.url], pr)))
        update((draft) => {
          for (const pr of prs) draft.prs[pr.url] = pr
        })
    }

    const recover = (sessionID: string) => {
      const root = context.data.session.root(sessionID)
      if (recovered.has(root)) return
      recovered.add(root)
      void adopt(
        root,
        createdPrUrls(
          [...new Set([root, ...context.data.session.family(root)])].flatMap((member) =>
            context.data.session.message.list(member),
          ),
        ),
      )
    }

    const refresh = async () => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        const branch = context.data.location.vcs.info(context.location)?.branch.current
        const candidate = branch ? await fetchPr(directory) : undefined
        const current =
          candidate?.state === "OPEN" ||
          (candidate?.state === "MERGED" &&
            candidate.mergedAt &&
            Date.now() - Date.parse(candidate.mergedAt) < 60 * 60_000)
            ? candidate
            : undefined
        const urls = (state.roots[activeRoot] ?? []).filter((url) => url !== current?.url)
        const prs = (await Promise.all(urls.map((url) => fetchPr(directory, url)))).filter((pr) => pr !== undefined)
        if (disposed || (!changed(state.current, current) && !prs.some((pr) => changed(state.prs[pr.url], pr)))) return
        update((draft) => {
          draft.current = current
          for (const pr of prs) draft.prs[pr.url] = pr
        })
      } finally {
        inFlight = false
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    const unsubscribers = [
      context.data.on("session.shell.ended", (event) => {
        if (event.data.shell.status !== "exited" || event.data.shell.exit !== 0) return
        void adopt(event.data.sessionID, prUrls(event.data.shell.command, event.data.output.output))
      }),
      context.data.on("session.tool.success", (event) => {
        const message = context.data.session.message.get(event.data.sessionID, event.data.assistantMessageID)
        if (message?.type !== "assistant") return
        const part = message.content.find((item) => item.type === "tool" && item.id === event.data.id)
        if (!part?.state || part.state.status !== "completed") return
        const input = part.state.input
        const command =
          typeof input === "object" && input !== null && !Array.isArray(input) && "command" in input
            ? input.command
            : undefined
        void adopt(
          event.data.sessionID,
          prUrls(
            command,
            event.data.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n"),
          ),
        )
      }),
      context.data.on("vcs.branch.updated", () => void refresh()),
    ]

    context.ui.slot({
      after: "prompt.footer.file",
      render: () => (
        <text
          fg={state.current ? statusColor(state.current) : undefined}
          flexShrink={0}
          onMouseUp={() => {
            if (state.current) Bun.spawn(["open", state.current.url], { stdout: "ignore", stderr: "ignore" })
          }}
        >
          {state.current ? `#${state.current.number}` : ""}
        </text>
      ),
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        activeRoot = context.data.session.root(props.sessionID)
        recover(props.sessionID)
        const list = () => {
          const urls = state.roots[context.data.session.root(props.sessionID)] ?? []
          const prs = new Map<string, Pr>()
          if (state.current) prs.set(state.current.url, state.current)
          for (const url of urls) {
            const pr = state.prs[url]
            if (pr) prs.set(url, pr)
          }
          return [...prs.values()]
        }
        return (
          <>
            {list().length > 0 ? (
              <box>
                <text fg={context.theme.text.default}>
                  <b>Pull requests</b>
                </text>
                {list().map((pr) => (
                  <box flexDirection="row" gap={1} onMouseUp={() => Bun.spawn(["open", pr.url])}>
                    <text fg={statusColor(pr)} flexShrink={0}>
                      {statusIcon(pr)}
                    </text>
                    <text fg={context.theme.text.default} wrapMode="word">
                      <span style={{ fg: context.theme.text.subdued }}>#{pr.number}</span> {pr.title}
                    </text>
                  </box>
                ))}
              </box>
            ) : undefined}
          </>
        )
      },
    })

    return () => {
      disposed = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      clearInterval(timer)
    }
  },
})

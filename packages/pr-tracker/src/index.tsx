/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, untrack } from "solid-js"
import { prReferences } from "./reference"

const STALE_MS = 15_000

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

function createdPrReferences(messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>) {
  const references = new Set<string | undefined>()
  const adopt = (command: unknown, output: unknown) =>
    prReferences(command, output).forEach((reference) => references.add(reference))

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
  return [...references]
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

function PrRow(props: { context: Plugin.Context; pr: Pr }) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={hovered() ? props.context.theme.background.action.primary.hovered : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => Bun.spawn(["open", props.pr.url])}
    >
      <text fg={statusColor(props.pr)} flexShrink={0}>
        {statusIcon(props.pr)}
      </text>
      <text fg={props.context.theme.text.default} wrapMode="word">
        <span
          style={{
            fg: hovered() ? props.context.theme.text.default : props.context.theme.text.subdued,
          }}
        >
          #{props.pr.number}
        </span>{" "}
        {props.pr.title}
      </text>
    </box>
  )
}

export default Plugin.define({
  id: "kit.pr-tracker",
  setup: async (context) => {
    const directory = context.location?.directory
    if (!directory) return
    const [state, update] = context.storage.memory("pr-sidebar-v2", {
      initial: {
        roots: {} as Record<string, string[]>,
        prs: {} as Record<string, Pr>,
      },
    })

    let disposed = false
    const recovered = new Set<string>()
    const checkedAt = new Map<string, number>()
    const inFlight = new Map<string, Promise<Pr | undefined>>()
    const [current, setCurrent] = createSignal<Pr>()
    let currentCheckedAt = 0
    let currentInFlight: Promise<Pr | undefined> | undefined

    const fetchCurrent = (staleOnly: boolean) => {
      if (staleOnly && Date.now() - currentCheckedAt < STALE_MS) return Promise.resolve(current())
      if (currentInFlight) return currentInFlight
      currentInFlight = fetchPr(directory).finally(() => {
        currentCheckedAt = Date.now()
        currentInFlight = undefined
      })
      return currentInFlight
    }

    const load = (url: string, staleOnly: boolean) => {
      if (staleOnly && Date.now() - (checkedAt.get(url) ?? 0) < STALE_MS) return Promise.resolve(state.prs[url])
      const active = inFlight.get(url)
      if (active) return active
      const request = fetchPr(directory, url).finally(() => {
        checkedAt.set(url, Date.now())
        inFlight.delete(url)
      })
      inFlight.set(url, request)
      return request
    }

    const adopt = async (sessionID: string, references: Array<string | undefined>, staleOnly = false) => {
      if (disposed || references.length === 0) return
      const prs = (
        await Promise.all(
          references.map((reference) =>
            reference === undefined
              ? fetchCurrent(staleOnly)
              : staleOnly && state.prs[reference]
                ? load(reference, true)
                : fetchPr(directory, reference),
          ),
        )
      ).filter((pr) => pr !== undefined)
      if (disposed || prs.length === 0) return
      const root = context.data.session.root(sessionID)
      const previous = state.roots[root] ?? []
      const next = [...new Set([...previous, ...prs.map((pr) => pr.url)])]
      if (next.length !== previous.length || prs.some((pr) => changed(state.prs[pr.url], pr)))
        update((draft) => {
          draft.roots[root] = next
          for (const pr of prs) draft.prs[pr.url] = pr
        })
    }

    const refreshCurrent = async () => {
      if (disposed) return
      const pr = await fetchCurrent(true)
      if (!disposed && changed(current(), pr)) setCurrent(pr)
    }

    const refresh = async (root: string) => {
      if (disposed) return
      const prs = (await Promise.all((state.roots[root] ?? []).map((url) => load(url, true)))).filter(
        (pr) => pr !== undefined,
      )
      if (disposed || !prs.some((pr) => changed(state.prs[pr.url], pr))) return
      update((draft) => {
        for (const pr of prs) draft.prs[pr.url] = pr
      })
    }

    const unsubscribers = [
      context.data.on("session.shell.ended", (event) => {
        if (event.data.shell.status !== "exited" || event.data.shell.exit !== 0) return
        void adopt(event.data.sessionID, prReferences(event.data.shell.command, event.data.output.output))
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
          prReferences(
            command,
            event.data.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n"),
          ),
        )
      }),
    ]

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const root = () => context.data.session.root(props.sessionID)
        createEffect(() => {
          const currentRoot = root()
          untrack(() => {
            void refreshCurrent()
            void refresh(currentRoot)
            if (recovered.has(currentRoot)) return
            recovered.add(currentRoot)
            void adopt(
              currentRoot,
              createdPrReferences(
                [...new Set([currentRoot, ...context.data.session.family(currentRoot)])].flatMap((member) =>
                  context.data.session.message.list(member),
                ),
              ),
              true,
            )
          })
        })
        const list = () => {
          const urls = state.roots[root()] ?? []
          const prs = new Map<string, Pr>()
          const branch = current()
          if (branch?.state === "OPEN") prs.set(branch.url, branch)
          for (const url of urls) {
            const pr = state.prs[url]
            if (pr?.state === "OPEN") prs.set(url, pr)
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
                  <PrRow context={context} pr={pr} />
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
    }
  },
})

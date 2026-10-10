/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { requestReferences, type Reference } from "./reference"
import { fetchPr, mrReference, type Pr } from "./request"
import { createHistoryReader } from "./history"

const STALE_MS = 15_000
const POLL_MS = 45_000

const COLORS: Record<string, string> = {
  OPEN: "#a6da95",
  MERGED: "#c6a0f6",
  CLOSED: "#ed8796",
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
          {props.pr.provider === "gitlab" ? "!" : "#"}{props.pr.number}
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
        rootIDs: {} as Record<string, string>,
      },
    })
    const [manual, updateManual] = context.storage.store("manual-mrs-v1", {
      initial: { roots: {} as Record<string, string[]> },
    })

    let disposed = false
    const rootOf = (sessionID: string) => state.rootIDs?.[sessionID] ?? context.data.session.root(sessionID)
    const history = createHistoryReader(context.client)
    const abort = new AbortController()
    const recoveryInFlight = new Map<string, Promise<void>>()
    const recoveryCheckedAt = new Map<string, number>()
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

    const adopt = async (
      sessionID: string,
      references: Reference[],
      staleOnly = false,
      requestDirectory = directory,
      root = rootOf(sessionID),
    ) => {
      if (disposed || references.length === 0) return
      const prs = (
        await Promise.all(
          references.map((reference) =>
            reference.provider === "github" && reference.value === undefined && requestDirectory === directory
              ? fetchCurrent(staleOnly)
              : reference.value && staleOnly && state.prs[reference.value]
                ? load(reference.value, true)
                : fetchPr(requestDirectory, reference),
          ),
        )
      ).filter((pr) => pr !== undefined)
      if (disposed || prs.length === 0) return
      const previous = state.roots[root] ?? []
      const next = [...new Set([...previous, ...prs.map((pr) => pr.url)])]
      if (next.length !== previous.length || prs.some((pr) => changed(state.prs[pr.url], pr)))
        update((draft) => {
          draft.roots[root] = next
          for (const pr of prs) draft.prs[pr.url] = pr
        })
    }

    const recover = (sessionID: string) => {
      if (disposed || Date.now() - (recoveryCheckedAt.get(sessionID) ?? 0) < STALE_MS) return Promise.resolve()
      const active = recoveryInFlight.get(sessionID)
      if (active) return active
      const request = history.recover(sessionID, abort.signal).then(async ({ rootID, members }) => {
        if (disposed) return
        if (members.some((member) => state.rootIDs?.[member.id] !== rootID))
          update((draft) => {
            draft.rootIDs ??= {}
            for (const member of members) draft.rootIDs[member.id] = rootID
          })
        await Promise.all(members.map((member) => adopt(member.id, member.references, true, member.directory, rootID)))
        if (!disposed) recoveryCheckedAt.set(sessionID, Date.now())
      }).catch(() => {
        // Do not mark failed history reads complete; the next refresh retries.
      }).finally(() => recoveryInFlight.delete(sessionID))
      recoveryInFlight.set(sessionID, request)
      return request
    }

    const refreshCurrent = async () => {
      if (disposed) return
      const pr = await fetchCurrent(true)
      if (!disposed && changed(current(), pr)) setCurrent(pr)
    }

    const refresh = async (root: string) => {
      if (disposed) return
      const urls = [...new Set([...(state.roots[root] ?? []), ...(manual.roots[root] ?? [])])]
      const prs = (await Promise.all(urls.map((url) => load(url, true)))).filter(
        (pr) => pr !== undefined,
      )
      if (disposed || !prs.some((pr) => changed(state.prs[pr.url], pr))) return
      update((draft) => {
        for (const pr of prs) draft.prs[pr.url] = pr
      })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "kit.pr-tracker.track",
        title: "Track a merge request",
        group: "GitLab",
        palette: true,
        slash: { name: "mr-track", arguments: true },
        enabled: () => context.ui.router.current().type === "session",
        run: async (input) => {
          const route = context.ui.router.current()
          if (route.type !== "session") {
            context.ui.toast.show({ message: "Open a session before tracking a merge request.", variant: "error" })
            return
          }
          const value = input?.trim() || await context.ui.dialog.prompt({ title: "Track a merge request", placeholder: "GitLab MR URL" })
          if (value === undefined) return
          const reference = mrReference(value.trim())
          if (!reference) {
            context.ui.toast.show({ message: "Enter a full GitLab merge request URL.", variant: "error" })
            return
          }
          try {
            const session = await context.client.session.get({ sessionID: route.sessionID })
            let root = session
            while (root.parentID) root = await context.client.session.get({ sessionID: root.parentID })
            const pr = await fetchPr(session.location.directory, reference)
            if (!pr || pr.provider !== "gitlab") {
              context.ui.toast.show({ message: "Cannot load this MR. Check the URL and glab sign-in.", variant: "error" })
              return
            }
            if (disposed) return
            await updateManual((draft) => {
              draft.roots[root.id] = [...new Set([...(draft.roots[root.id] ?? []), pr.url])]
            })
            if (disposed) return
            update((draft) => {
              draft.rootIDs ??= {}
              draft.rootIDs[session.id] = root.id
              draft.prs[pr.url] = pr
            })
            context.ui.toast.show({
              message: pr.state === "OPEN" ? `Tracked !${pr.number}.` : `Tracked !${pr.number}. Closed and merged MRs stay hidden.`,
              variant: pr.state === "OPEN" ? "success" : "info",
            })
          } catch {
            context.ui.toast.show({ message: "Cannot track this MR. Check the session, glab sign-in, and local storage.", variant: "error" })
          }
        },
      }],
    }))

    const unsubscribers = [
      context.data.on("session.shell.ended", (event) => {
        if (event.data.shell.status !== "exited" || event.data.shell.exit !== 0) return
        void adopt(event.data.sessionID, requestReferences(event.data.shell.command, event.data.output.output))
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
          requestReferences(
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
        const root = () => rootOf(props.sessionID)
        createEffect(() => {
          const route = context.ui.router.current()
          if (route.type !== "session" || route.sessionID !== props.sessionID) return
          const timer = setInterval(() => {
            void refreshCurrent()
            void refresh(root())
            void recover(props.sessionID)
          }, POLL_MS)
          onCleanup(() => clearInterval(timer))
        })
        createEffect(() => {
          const currentRoot = root()
          untrack(() => {
            void refreshCurrent()
            void refresh(currentRoot)
            void recover(props.sessionID)
          })
        })
        const list = () => {
          const urls = [...new Set([...(state.roots[root()] ?? []), ...(manual.roots[root()] ?? [])])]
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
                  <b>{list().every((pr) => pr.provider === "gitlab") ? "Merge requests" : "Pull requests"}</b>
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
      abort.abort()
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  },
})

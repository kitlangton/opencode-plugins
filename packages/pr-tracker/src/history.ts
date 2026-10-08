import { requestReferences, type Reference } from "./reference"

type Session = {
  id: string
  parentID?: string
  location: { directory: string }
  time: { updated: number }
}
type Message = {
  type: string
  status?: string
  exit?: number | string
  command?: unknown
  output?: { output: string }
  content?: readonly ({ type: "text" | "reasoning" } | {
    type: "tool"
    state: {
      status: string
      input: unknown
      content?: readonly { type: string; text?: string }[]
    }
  })[]
}
type Page<T> = { data: readonly T[]; cursor: { next?: string | null } }
type Options = { signal: AbortSignal }
type Client = {
  session: {
    get(input: { sessionID: string }, options: Options): Promise<Session>
    list(input: { parentID: string; limit: number; order?: "asc"; cursor?: string }, options: Options): Promise<Page<Session>>
  }
  message: {
    list(input: { sessionID: string; limit: number; order?: "asc"; cursor?: string }, options: Options): Promise<Page<Message>>
  }
}

export function createHistoryReader(client: Client) {
  const cache = new Map<string, { updated: number; references: Reference[] }>()

  const read = async (session: Session, signal: AbortSignal) => {
    const previous = cache.get(session.id)
    if (previous?.updated === session.time.updated) return previous.references
    const references = new Map<string, Reference>()
    const adopt = (command: unknown, output: unknown) => {
      for (const reference of requestReferences(command, output)) references.set(JSON.stringify(reference), reference)
    }
    let cursor: string | undefined
    do {
      signal.throwIfAborted()
      const page = await client.message.list({ sessionID: session.id, limit: 100, ...(cursor ? { cursor } : { order: "asc" as const }) }, { signal })
      if (page.data.length === 0) break
      for (const message of page.data) {
        if (message.type === "shell") {
          if (message.status === "exited" && message.exit === 0) adopt(message.command, message.output?.output)
        } else if (message.type === "assistant") {
          for (const part of message.content ?? []) {
            if (part.type !== "tool" || part.state.status !== "completed") continue
            const input = part.state.input
            const command = typeof input === "object" && input !== null && "command" in input ? input.command : undefined
            adopt(command, (part.state.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n"))
          }
        }
      }
      cursor = page.cursor.next ?? undefined
    } while (cursor !== undefined)
    signal.throwIfAborted()
    const result = [...references.values()]
    // A failed or cancelled page must not make a partial transcript look current.
    cache.set(session.id, { updated: session.time.updated, references: result })
    return result
  }

  return {
    async recover(sessionID: string, signal: AbortSignal) {
      signal.throwIfAborted()
      let root = await client.session.get({ sessionID }, { signal })
      while (root.parentID) {
        signal.throwIfAborted()
        root = await client.session.get({ sessionID: root.parentID }, { signal })
      }
      const sessions = new Map<string, Session>([[root.id, root]])
      for (const session of sessions.values()) {
        let cursor: string | undefined
        do {
          signal.throwIfAborted()
          const page = await client.session.list({ parentID: session.id, limit: 100, ...(cursor ? { cursor } : { order: "asc" as const }) }, { signal })
          if (page.data.length === 0) break
          for (const child of page.data) sessions.set(child.id, child)
          cursor = page.cursor.next ?? undefined
        } while (cursor !== undefined)
      }
      const members = await Promise.all([...sessions.values()].map(async (session) => ({
        id: session.id,
        directory: session.location.directory,
        references: await read(session, signal),
      })))
      signal.throwIfAborted()
      return { rootID: root.id, members }
    },
  }
}

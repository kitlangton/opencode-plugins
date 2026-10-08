import type { Reference } from "./reference"

type Check = { status?: string; conclusion?: string }
export type Pr = {
  provider?: "github" | "gitlab"
  number: number
  url: string
  state: string
  title: string
  isDraft: boolean
  mergedAt?: string
  statusCheckRollup: Check[]
}

async function run(cwd: string, ...command: string[]): Promise<unknown> {
  try {
    const proc = Bun.spawn(command, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GLAB_NO_PROMPT: "1" },
    })
    const stdout = await proc.stdout.text()
    if ((await proc.exited) !== 0) return undefined
    return JSON.parse(stdout)
  } catch {
    // Missing CLIs, expired authentication, and invalid responses must not break the sidebar.
    return undefined
  }
}

function mrReference(value: string): Reference | undefined {
  try {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined
    const path = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)\/?$/)
    return path ? { provider: "gitlab", value: path[2], repository: `${url.origin}/${path[1]}` } : undefined
  } catch {
    return undefined
  }
}

async function github(directory: string, reference?: Reference): Promise<Pr | undefined> {
  const parsed = await run(
    directory,
    "gh",
    "pr",
    "view",
    ...(reference?.value ? [reference.value] : []),
    "--json",
    "number,url,state,title,isDraft,mergedAt,statusCheckRollup",
  )
  if (typeof parsed !== "object" || parsed === null) return undefined
  if (!("number" in parsed) || typeof parsed.number !== "number" || !("url" in parsed) || typeof parsed.url !== "string")
    return undefined
  return parsed as Pr
}

async function gitlab(directory: string, reference?: Reference): Promise<Pr | undefined> {
  const parsed = await run(
    directory,
    "glab",
    "mr",
    "view",
    ...(reference?.value ? [reference.value] : []),
    ...(reference?.repository ? ["--repo", reference.repository] : []),
    "--output",
    "json",
  )
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  if (
    !("iid" in parsed) || typeof parsed.iid !== "number" ||
    !("web_url" in parsed) || typeof parsed.web_url !== "string" ||
    !("title" in parsed) || typeof parsed.title !== "string" ||
    !("state" in parsed) || typeof parsed.state !== "string"
  )
    return undefined
  if (!mrReference(parsed.web_url)) return undefined
  const pipeline = ("head_pipeline" in parsed ? parsed.head_pipeline : undefined)
    ?? ("pipeline" in parsed ? parsed.pipeline : undefined)
  const status = typeof pipeline === "object" && pipeline !== null && "status" in pipeline ? pipeline.status : undefined
  const check: Check | undefined = typeof status !== "string" ? undefined
    : status === "success" ? { status: "COMPLETED", conclusion: "SUCCESS" }
    : status === "failed" ? { status: "COMPLETED", conclusion: "FAILURE" }
    : status === "canceled" ? { status: "COMPLETED", conclusion: "CANCELLED" }
    : status === "skipped" ? { status: "COMPLETED", conclusion: "SKIPPED" }
    : { status: "IN_PROGRESS" }
  return {
    provider: "gitlab",
    number: parsed.iid,
    url: parsed.web_url,
    title: parsed.title,
    state: parsed.state === "opened" ? "OPEN" : parsed.state.toUpperCase(),
    isDraft: ("draft" in parsed && parsed.draft === true) || ("work_in_progress" in parsed && parsed.work_in_progress === true),
    statusCheckRollup: check ? [check] : [],
  }
}

export async function fetchPr(directory: string, reference?: string | Reference): Promise<Pr | undefined> {
  if (typeof reference === "string") {
    const mr = mrReference(reference)
    if (mr) return gitlab(directory, mr)
    return github(directory, { provider: "github", value: reference })
  }
  if (reference?.provider === "gitlab") {
    const mr = reference.value ? mrReference(reference.value) : undefined
    return gitlab(directory, mr ?? reference)
  }
  if (reference) return github(directory, reference)
  return (await github(directory)) ?? (await gitlab(directory))
}

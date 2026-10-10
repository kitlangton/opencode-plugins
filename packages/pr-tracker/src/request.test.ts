import { afterAll, beforeAll, describe, test } from "bun:test"
import { strict as assert } from "node:assert"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { requestReferences, type Reference } from "./reference"
import type { Pr } from "./request"

let directory: string
const url = "https://code.example.com/group/team/widget/-/merge_requests/42"
const mr = { iid: 42, web_url: url, title: "Update widget", state: "opened", draft: false, head_pipeline: { status: "success" } }
const pull = { number: 7, url: "https://github.com/acme/widget/pull/7", title: "Update widget", state: "OPEN", isDraft: false, statusCheckRollup: [] }

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pr-tracker-"))
  for (const cli of ["gh", "glab"]) {
    const file = path.join(directory, cli)
    await writeFile(file, `#!/bin/sh
if [ "$1 $2" != "${cli === "gh" ? "pr" : "mr"} view" ]; then exit 1; fi
${cli === "glab" ? `if [ -n "$EXPECTED_REPO" ]; then
  if [ "$3 $4 $5" != "42 --repo $EXPECTED_REPO" ]; then exit 1; fi
fi
if [ -n "$EXPECTED_SELECTOR" ] && [ "$3" != "$EXPECTED_SELECTOR" ]; then exit 1; fi
if [ "$GLAB_NO_PROMPT" != "1" ]; then exit 1; fi` : ""}
printf '%s' "$${cli === "gh" ? "GITHUB_RESPONSE" : "GITLAB_RESPONSE"}"
exit "$${cli === "gh" ? "GITHUB_EXIT" : "GITLAB_EXIT"}"
`)
    await chmod(file, 0o755)
  }
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fetch(reference?: string | Reference, options: {
  github?: unknown
  gitlab?: unknown
  githubExit?: number
  gitlabExit?: number
  expectedRepo?: string
  expectedSelector?: string
  missingCli?: boolean
  directory?: string
} = {}): Promise<Pr | null> {
  // Isolate PATH and authentication fixtures from both the user's CLIs and other tests.
  const proc = Bun.spawn([process.execPath, "--eval", `
    import { fetchPr } from ${JSON.stringify(path.join(import.meta.dir, "request.ts"))};
    const reference = JSON.parse(process.env.REFERENCE);
    console.log(JSON.stringify(await fetchPr(process.env.DIRECTORY, reference ?? undefined) ?? null));
  `], {
    env: {
      PATH: options.missingCli ? path.join(directory, "missing") : directory,
      DIRECTORY: options.directory ?? directory,
      REFERENCE: JSON.stringify(reference ?? null),
      GITHUB_RESPONSE: typeof options.github === "string" ? options.github : JSON.stringify(options.github ?? pull),
      GITLAB_RESPONSE: typeof options.gitlab === "string" ? options.gitlab : JSON.stringify(options.gitlab ?? mr),
      GITHUB_EXIT: String(options.githubExit ?? 1),
      GITLAB_EXIT: String(options.gitlabExit ?? 0),
      EXPECTED_REPO: options.expectedRepo ?? "",
      EXPECTED_SELECTOR: options.expectedSelector ?? "",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await proc.stdout.text()
  const stderr = await proc.stderr.text()
  assert.equal(await proc.exited, 0, stderr)
  return JSON.parse(stdout)
}

describe("fetchPr", () => {
  test("finds the current branch's merge request when GitHub is unavailable", async () => {
    assert.deepEqual(await fetch(), {
      provider: "gitlab", number: 42, url, title: "Update widget", state: "OPEN", isDraft: false,
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    })
    assert.deepEqual(await fetch(undefined, { githubExit: 0 }), pull)
  })

  test("uses an adopted merge request's host and nested project rather than the current repository", async () => {
    const request = await fetch(url, { githubExit: 0, expectedRepo: "https://code.example.com/group/team/widget" })
    assert(request !== null)
    assert.equal(request.provider, "gitlab")
    assert.equal(request.url, url)
    assert.equal(request.number, 42)
    const overridden = await fetch({ provider: "gitlab", value: "42", repository: "https://code.example.com/group/team/widget" }, {
      githubExit: 0, expectedRepo: "https://code.example.com/group/team/widget",
    })
    assert.deepEqual(overridden, request)
    const reference = requestReferences("glab mr update --draft 42-fix", "")[0]
    assert(reference !== undefined)
    const branch = await fetch(reference, { expectedSelector: "42-fix" })
    assert.deepEqual(branch, request)
  })

  test("retains merge, draft, and pipeline states needed by the sidebar", async () => {
    for (const [status, check] of [
      ["failed", { status: "COMPLETED", conclusion: "FAILURE" }],
      ["canceled", { status: "COMPLETED", conclusion: "CANCELLED" }],
      ["skipped", { status: "COMPLETED", conclusion: "SKIPPED" }],
      ["running", { status: "IN_PROGRESS" }],
      ["manual", { status: "IN_PROGRESS" }],
    ] as const) {
      const request = await fetch(url, { gitlab: { ...mr, head_pipeline: { status } } })
      assert(request !== null)
      assert.deepEqual(request.statusCheckRollup, [check])
    }
    for (const [state, expected] of [["merged", "MERGED"], ["closed", "CLOSED"]]) {
      const request = await fetch(url, { gitlab: { ...mr, state, head_pipeline: null } })
      assert(request !== null)
      assert.equal(request.state, expected)
      assert.deepEqual(request.statusCheckRollup, [])
    }
    const draft = await fetch(url, { gitlab: { ...mr, draft: true } })
    assert(draft !== null)
    assert.equal(draft.isDraft, true)
    const legacyDraft = await fetch(url, { gitlab: { ...mr, work_in_progress: true } })
    assert(legacyDraft !== null)
    assert.equal(legacyDraft.isDraft, true)
    const legacyPipeline = await fetch(url, { gitlab: { ...mr, head_pipeline: null, pipeline: { status: "failed" } } })
    assert(legacyPipeline !== null)
    assert.deepEqual(legacyPipeline.statusCheckRollup, [{ status: "COMPLETED", conclusion: "FAILURE" }])
  })

  test("can refresh an explicit MR URL after its original worktree is removed", async () => {
    const missing = path.join(directory, "removed-worktree")
    const request = await fetch(url, { directory: missing, expectedRepo: "https://code.example.com/group/team/widget" })
    assert(request !== null)
    assert.equal(request.url, url)
    assert.equal(await fetch({ provider: "gitlab", value: "42" }, { directory: missing }), null,
      "a numeric MR must not fall back to a different repository")
    assert.equal(await fetch({ provider: "gitlab", repository: "https://code.example.com/group/team/widget" },
      { directory: missing }), null,
      "a repository without a selector must not use another checkout's branch")
  })

  test("does not break the sidebar when a CLI is missing, access is denied, or JSON is invalid", async () => {
    assert.equal(await fetch(url, { missingCli: true }), null)
    assert.equal(await fetch(url, { gitlabExit: 1 }), null)
    assert.equal(await fetch(url, { gitlab: "invalid JSON" }), null)
    assert.equal(await fetch(url, { gitlab: { ...mr, iid: "42" } }), null)
    assert.equal(await fetch(url, { gitlab: { ...mr, web_url: "file:///etc/passwd" } }), null)
    assert.equal(await fetch(undefined, { github: "invalid JSON", gitlabExit: 1 }), null)
  })
})

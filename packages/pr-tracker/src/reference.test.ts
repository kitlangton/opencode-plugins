import { describe, expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import { prReferences, requestReferences } from "./reference"

describe("prReferences", () => {
  test("adopts pull requests created or edited by gh", () => {
    expect(prReferences("gh pr create --title test", "https://github.com/acme/widget/pull/12")).toEqual([
      "https://github.com/acme/widget/pull/12",
    ])
    expect(prReferences("gh pr edit 42 --base v2", "")).toEqual(["42"])
    expect(prReferences("gh pr edit --base v2", "")).toEqual([undefined])
    expect(prReferences("gh pr edit 42 --base v2", "https://github.com/acme/widget/pull/42")).toEqual([
      "https://github.com/acme/widget/pull/42",
    ])
  })

  test("derives pull request URLs from GitHub API commands", () => {
    expect(prReferences('gh api --method PATCH repos/acme/widget/pulls/42 -f body="updated" --silent', "")).toEqual([
      "https://github.com/acme/widget/pull/42",
    ])
  })

  test("ignores unrelated commands and mentioned pull requests", () => {
    expect(prReferences("gh pr view 42", "https://github.com/acme/widget/pull/42")).toEqual([])
    expect(prReferences("echo repos/acme/widget/pulls/42", "")).toEqual([])
    expect(prReferences("printf hello", "https://github.com/acme/widget/pull/42")).toEqual([])
  })
})

describe("requestReferences", () => {
  test("adopts merge requests created or updated by glab on any host", () => {
    const url = "https://code.example.com/group/team/widget/-/merge_requests/12"
    assert.deepEqual(requestReferences("glab mr create --title test", `${url}\n${url}`), [
      { provider: "gitlab", value: url },
    ])
    assert.deepEqual(requestReferences(`glab mr update '${url}' --title changed`, ""), [
      { provider: "gitlab", value: url, repository: undefined },
    ])
    assert.deepEqual(requestReferences("glab mr update 42 --repo 'https://code.example.com/group/widget'", ""), [
      { provider: "gitlab", value: "42", repository: "https://code.example.com/group/widget" },
    ])
    assert.deepEqual(requestReferences("glab mr update --title changed", ""), [
      { provider: "gitlab", value: undefined, repository: undefined },
    ])
    assert.deepEqual(requestReferences("glab mr update --draft --repo=group/widget 42-fix", ""), [
      { provider: "gitlab", value: "42-fix", repository: "group/widget" },
    ])
    assert.deepEqual(requestReferences("glab mr update -t 'Changed title' feature/widget", ""), [
      { provider: "gitlab", value: "feature/widget", repository: undefined },
    ])
    assert.deepEqual(requestReferences("cd widget && glab mr update 42", ""), [])
    assert.deepEqual(requestReferences("cd widget && glab mr update 42", url), [{ provider: "gitlab", value: url }])
    assert.deepEqual(requestReferences("gh pr edit 42 --base v2", ""), [{ provider: "github", value: "42" }])
  })

  test("ignores merge requests merely mentioned or viewed during research", () => {
    const url = "https://gitlab.com/group/widget/-/merge_requests/42"
    for (const command of ["glab mr view 42", "glab mr list", "printf hello", "glab mr create --dry-run",
      "glab mr create --web", "glab mr update --help", "printf '%s\\n' 'glab mr update 42'",
      "printf '%s\\n' 'example; glab mr update 42'", "glab mr update 42-fix --draft >/dev/null",
      'glab mr update "$MR"', "glab mr update 42*",
      "glab mr update 42 || true", "glab mr update 42 &", "glab mr update 42 && printf hello"])
      assert.deepEqual(requestReferences(command, url), [], command)
    assert.deepEqual(requestReferences("glab mr update --unknown-option 42", ""), [])
    assert.deepEqual(requestReferences(undefined, url), [])
  })

  test("adopts only the operation's result, not URLs echoed in changed titles", () => {
    const mentioned = "https://other.example.com/group/widget/-/merge_requests/99"
    const result = "https://code.example.com/group/widget/-/merge_requests/42"
    assert.deepEqual(requestReferences(`glab mr update 42 --title '${mentioned}'`, `updated title to "${mentioned}"\n${result}\n`), [
      { provider: "gitlab", value: result },
    ])
    assert.deepEqual(requestReferences("glab mr create --auto-merge", `${result}\n✓ Auto-merge enabled. Will merge when all checks pass.\n`), [
      { provider: "gitlab", value: result },
    ])
    assert.deepEqual(requestReferences("glab mr update 42", `updated title to "${mentioned}"`), [])
  })
})

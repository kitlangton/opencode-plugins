import { describe, expect, test } from "bun:test"
import { prReferences } from "./reference"

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

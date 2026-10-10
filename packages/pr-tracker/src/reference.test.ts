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
  test("adopts merge requests from GitLab API updates and JSON result filters", () => {
    const url = "https://gitlab.cdn77.eu/net/flop/flop/-/merge_requests/22920"
    const response = JSON.stringify({ iid: 22920, project_id: 2, web_url: url })
    for (const command of [
      "glab api projects/2/merge_requests/22920 --method PUT -f description='Updated description'",
      "glab api projects/2/merge_requests/22920 --method PUT -f description='Updated description' | jq '{iid,web_url}'",
      "glab api projects/2/merge_requests/22920 -XPUT -fdescription=text | jq -c '{iid,sha,web_url,head_pipeline: (.head_pipeline | {id,status,sha})}'",
      "glab api projects/2/merge_requests/22920 -X=PUT -f=description=text",
      "glab api projects/2/merge_requests/22920 -X PUT |\n jq '{iid: .iid,web_url: .web_url}'",
      "glab api projects/2/merge_requests/22920 -X PUT | jq '.'",
      "glab api -X PUT projects/net%2Fflop%2Fflop/merge_requests/22920 --hostname gitlab.cdn77.eu --input body.json",
      "glab api --method=PUT projects/:id/merge_requests/22920 --raw-field=description=updated",
      "glab api projects/2/merge_requests/22920 -X PUT -f description=\"$(cat <<'EOF'\nDetails with $text and `code`.\nEOF\n)\" | jq '{iid,web_url}'",
      "glab api projects/2/merge_requests/22920 -X PUT -f description=$'Details with \\nlines'",
    ]) assert.deepEqual(requestReferences(command, response), [{ provider: "gitlab", value: url }], command)

    for (const command of [
      "glab api projects/2/merge_requests/22920",
      "glab api projects/2/merge_requests/22920 -X GET -f description=updated",
      "glab api projects/2/merge_requests/22920 -X POST -f description=updated",
      "glab api projects/2/merge_requests/22920 -X DELETE",
      "glab api projects/2/merge_requests/22920/discussions -X POST -f body=updated",
      "glab api projects/2/merge_requests/22920 -X PUT --help",
      "glab api projects/2/merge_requests/22920 -X PUT --silent",
      'glab api "$ENDPOINT" -X PUT',
      'glab api projects/2/merge_requests/22920 -X "$METHOD"',
      'glab api projects/2/merge_requests/22920 -X PUT --hostname "$HOST"',
      "glab api projects/2/merge_requests/22920 -X PUT | cat response.json",
      "glab api projects/2/merge_requests/22920 -X PUT && jq '{iid,web_url}' response.json",
      "glab api projects/2/merge_requests/22920 -X PUT | jq '{iid,web_url}' response.json",
      "glab api projects/2/merge_requests/22920 -X PUT | jq --argfile mr response.json '$mr'",
      "glab api projects/2/merge_requests/22920 -X PUT | jq '.description | fromjson | {iid,web_url}'",
      "glab api projects/2/merge_requests/22920 -X PUT | jq '{iid,web_url:.description}'",
      "glab api projects/2/merge_requests/22920 -X PUT | jq '{iid,web_url,web_url:.description}'",
      "printf '%s' 'glab api projects/2/merge_requests/22920 -X PUT'",
    ]) assert.deepEqual(requestReferences(command, response), [], command)

    const command = "glab api projects/2/merge_requests/22920 -X PUT"
    for (const output of ["", url, JSON.stringify({ iid: 22921, web_url: url }),
      JSON.stringify({ iid: 22920, web_url: "https://gitlab.cdn77.eu/net/flop/flop/-/merge_requests/22921" }),
      JSON.stringify({ iid: 22920, project_id: 3, web_url: url }), JSON.stringify([{ iid: 22920, web_url: url }])])
      assert.deepEqual(requestReferences(command, output), [], output)
    assert.deepEqual(requestReferences(`${command} --hostname gitlab.com`, response), [])
  })

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
    const result = "https://code.example.com/acme/widget/-/merge_requests/42"
    const body = "Quotes ' \"; `code`; $value; (details); EOF)\n)\" && glab mr update 43\nhttps://code.example.com/acme/widget/-/merge_requests/43"
    for (const command of [
      `glab mr create --source-branch feature --target-branch master --title 'Change' --description "$(cat <<'EOF'\n${body}\nEOF\n)" --label 'review' --remove-source-branch`,
      `glab mr create --description "$(cat << 'EOF'\n${body}\nEOF\n)"`,
      `glab mr update 42 --description "$(glab api projects/2/merge_requests/43 | python3 -c 'import json,sys; print(json.load(sys.stdin)["description"])')"`,
      String.raw`glab mr create --title 'Change' --description $'literal with \' quote and \n' --yes`,
      "glab mr update 42 --description $'text'",
      "glab mr update 42 --description=\"$(printf '%s' \"$(printf text)\")\"",
      "glab mr update 42 -d $'text' --title=\"$(printf 'Change')\"",
      "glab mr create -t $'Change' --description literal",
      `glab mr update 42 --title "$(cat <<'EOF'\n${body}\nEOF\n)"`,
      'glab mr update 42 --title="$TITLE" --description="${DESCRIPTION}"',
    ]) {
      assert.deepEqual(requestReferences(command, `${result}\n`), [{ provider: "gitlab", value: result }], command)
      assert.deepEqual(requestReferences(command, ""), [], command)
    }
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
    for (const command of [
      "printf '%s' \"glab mr update 42 --description $(printf text)\"",
      '"$(printf glab)" mr update 42 --description literal',
      "$'glab' mr update 42 --description literal",
      'glab "$(printf mr)" update 42 --description literal',
      'glab mr "$(printf update)" 42 --description literal',
      'glab mr update "$(printf 42)" --description literal',
      "glab mr update $'42' --description literal",
      'glab mr update 42 "$(printf -- --dry-run)"',
      "glab mr update 42 $'--dry-run' --description literal",
      'glab mr update 42 --"$(printf dry-run)"',
      'glab mr update 42 "$FLAGS" --description literal',
      'glab mr update 42 --description $(printf "text --dry-run")',
      'glab mr update --repo --description "$(printf 42)"',
      'glab mr update --label --title "$MR"',
      'glab mr update 42 --unknown-option --description "$(printf text)"',
      'glab mr update 42 --repo="$(printf acme/widget)"',
      'glab mr update 42 --description-file="$(printf body.md)"',
      'glab mr update 42 --description "$(printf text)" --web',
      'glab mr update 42 --description "$(printf text)" && printf https://code.example.com/acme/widget/-/merge_requests/42',
      'glab mr update 42 --description "$(printf text)"\nprintf https://code.example.com/acme/widget/-/merge_requests/42',
      'glab mr update 42 --description "$(printf text)"; printf https://code.example.com/acme/widget/-/merge_requests/42',
      'glab mr update 42 --description "$(printf text)" && glab mr update 43',
      'sh -c \'glab mr update 42 --description "$(printf text)"\'',
      'glab mr update 42 --description "$(printf text"',
      "glab mr update 42 --description $'unterminated\\'",
      `glab mr create --description "$(cat <<'EOF'\nbody\nEOF)\n)"`,
      `glab mr create --description "$(cat <<'EOF'\nbody\n)"`,
      `glab mr create --description "$(cat <<'EOF'\nbody\nEOF\n)`,
      `glab mr update 42 --description "$(# )"'\nprintf body\n)"\nprintf "%s\\n" "https://code.example.com/acme/widget/-/merge_requests/42"\n# '`,
      `glab mr update 42 --description "$(cat <<'EOF'\nbody\nEOF\r\n)"'\nEOF\n)"\nprintf "%s\\n" "https://code.example.com/acme/widget/-/merge_requests/42"\n# '`,
      `glab mr create --description "$(cat <<'EOF'\r\nbody\nEOF\n)"`,
    ]) assert.deepEqual(requestReferences(command, "https://code.example.com/acme/widget/-/merge_requests/42"), [], command)
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

# `@kitlangton/opencode-pr-tracker`

Tracks the checked-out branch's GitHub pull request or GitLab merge request, and
requests created or updated by a session or its subagents in the OpenCode V2 TUI
sidebar. Request state and CI status are refreshed when the session tab is
accessed and every 45 seconds while that session is active. Polling stops when
you leave the session or the sidebar is removed. Merged and closed requests are
hidden. GitHub requests use `#123`; GitLab requests use `!123`.

The plugin adopts pull requests from successful `gh pr create`, `gh pr edit`,
and `gh api repos/<owner>/<repo>/pulls/<number>` commands, and merge requests from
successful `glab mr create`, `glab mr update`, and `glab api` PUT updates to
`projects/<project>/merge_requests/<number>`. API updates use the returned JSON MR
number and URL, including `jq` projections that preserve those fields. Requests
merely mentioned or viewed during research do not appear.

When a session opens, recovery reads its complete history and its subagents'
history, including nested subagents. You do not need to open each subagent's tab
first. Recovery is retried during polling if a history read fails, and unchanged
histories are reused instead of downloaded again.
Explicit request URLs remain usable after their original worktree is removed.

For MRs updated through Python or other scripts, run `/mr-track <GitLab MR URL>`
in the owning session. The command validates the MR with `glab` and saves its
canonical URL for that session family. Explicit links survive TUI restarts and
do not appear in unrelated sessions. Closed and merged MRs remain hidden. Running
the command from the palette prompts for a URL.

```jsonc
{
  "plugins": ["@kitlangton/opencode-pr-tracker"],
}
```

Requires `git` and the authenticated CLI for the host: `gh` for GitHub or `glab`
for GitLab. GitLab.com and self-managed GitLab instances are supported, including
private projects that your account can access. The plugin uses the CLI's existing
credentials; do not put tokens in plugin settings.

For a self-managed instance, authenticate once with your own hostname:

```sh
glab auth login --hostname code.example.com
```

`glab` selects the host and project from Git remotes and its configuration. An
adopted MR URL selects its own host and project, including nested groups. Numeric
`glab mr update` references also respect `--repo` / `-R`. GitLab pipeline states
are shown using the same status indicators as GitHub checks.

Only the CLI's result URL is adopted, not URLs echoed in titles. Command recovery
accepts quoted title and description payloads, including shell-generated
descriptions and `$'…'` strings, without evaluating them. The executable and MR
operation must remain literal. Quoted command examples, dynamic targets, redirects,
and shell syntax that cannot be parsed safely are not adopted.

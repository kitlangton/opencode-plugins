# `@kitlangton/opencode-pr-tracker`

Tracks the checked-out branch's pull request and pull requests created or edited
by a session or its subagents in the OpenCode V2 TUI sidebar, with stale GitHub
state and CI status refreshed when the session tab is accessed. Merged and
closed pull requests are hidden.

The plugin adopts pull requests from successful `gh pr create`, `gh pr edit`,
and `gh api repos/<owner>/<repo>/pulls/<number>` commands, so pull requests
merely mentioned during research do not appear.

Requires OpenCode 2.0.24 or later in the 2.x series. Add this CLI-only plugin to
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@kitlangton/opencode-pr-tracker"]
}
```

Requires `git` and the authenticated GitHub CLI (`gh`).

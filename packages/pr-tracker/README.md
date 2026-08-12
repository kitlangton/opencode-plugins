# `@kitlangton/opencode-pr-tracker`

Tracks pull requests created by a session or its subagents in the OpenCode V2
TUI sidebar, with GitHub state and CI status refreshed while the session is
active.

The plugin adopts pull requests only from successful `gh pr create` shell or
tool output, so pull requests merely mentioned during research do not appear.

```jsonc
{
  "plugins": ["@kitlangton/opencode-pr-tracker"]
}
```

Requires `git` and the authenticated GitHub CLI (`gh`).

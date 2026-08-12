# OpenCode Plugins

Plugins for the [OpenCode](https://opencode.ai) V2 TUI.

## Plugins

### [`@kitlangton/opencode-pr-tracker`](./packages/pr-tracker)

Shows pull requests created by a session or its subagents in the sidebar, with
live GitHub and CI state. The current branch's pull request also appears in the
prompt footer.

```jsonc
{
  "plugins": ["@kitlangton/opencode-pr-tracker"]
}
```

### [`@kitlangton/opencode-session-recap`](./packages/session-recap)

Shows a one-sentence recap of your session above the composer, so you can remember where you left off after stepping away.

- `/recap` or the command palette generates one on demand.
- After three user turns, leaving the terminal unfocused for three minutes generates one automatically.
- New input dismisses it. Generation is read-only and never touches session history.

```jsonc
// opencode.jsonc
{
  "plugins": ["@kitlangton/opencode-session-recap"],
}
```

## Release

Add a changeset, push to `main`, then merge the release PR that CI opens:

```bash
bun run changeset
git push
```

Publishing runs in GitHub Actions through npm trusted publishing (OIDC). No tokens, no OTP.

## Local development

Point the TUI plugin list at a package's source file to keep OpenCode hot reload:

```jsonc
{
  "plugins": [
    "/path/to/opencode-plugins/packages/pr-tracker/src/index.tsx",
    "/path/to/opencode-plugins/packages/session-recap/src/tui.tsx"
  ]
}
```

Published packages use transformed bundles from `dist`; local development
continues to use `src` directly.

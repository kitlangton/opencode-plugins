# OpenCode Plugins

Plugins for the [OpenCode](https://opencode.ai) V2 TUI.

## Plugins

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

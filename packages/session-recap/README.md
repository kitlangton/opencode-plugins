# `@kitlangton/opencode-session-recap`

Generates a transient, read-only recap of the current OpenCode V2 session.

## Install

Add the package to `opencode.jsonc`:

```jsonc
{
  "plugins": ["@kitlangton/opencode-session-recap"],
}
```

The command palette provides **Generate session recap** and **Dismiss session recap**. `/recap` also generates one manually.

After three user turns, leaving the terminal unfocused for three minutes generates a recap automatically. New user input dismisses the current recap and aborts generation.

Requires an OpenCode V2 `next` release with `session.generate` and the `session.composer.top` TUI slot.

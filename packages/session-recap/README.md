# `@kitlangton/opencode-session-recap`

Shows a one-sentence recap of your OpenCode session above the composer, so you can remember where you left off after stepping away.

```text
Recap: Verified ordered input handling and a delayed shell response;
the next step is to review the resulting changes.

┌──────────────────────────────────────────────────────────────┐
│ >                                                            │
└──────────────────────────────────────────────────────────────┘
```

## Install

Add the package to `opencode.jsonc`, then restart OpenCode:

```jsonc
{
  "plugins": ["@kitlangton/opencode-session-recap"],
}
```

Requires an OpenCode V2 `next` release with `session.generate` and the `session.composer.top` TUI slot.

## Use

- **`/recap`** or **Generate session recap** in the command palette (`ctrl+p`) generates one on demand.
- After three user turns, leaving a session tab inactive for three minutes generates one automatically.
- Blurring the terminal makes every open tab inactive; switching tabs does not cancel generation already underway.
- **Dismiss session recap** in the palette, clicking the recap, or sending new input dismisses it.

Generation is read-only: it uses your session's model and history for one side request, and nothing enters the transcript.
Recaps and in-flight generation survive navigation between tabs for the lifetime of the TUI process.

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

Add the package to `~/.config/opencode/cli.json`, then restart OpenCode. If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode/cli.json` instead:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@kitlangton/opencode-session-recap"]
}
```

Requires OpenCode 2.0.24 or later in the 2.x release series. This is a CLI-only plugin: it runs locally in the terminal, including when connected to a remote server. Do not add it to `opencode.jsonc`; there is no project-local `cli.json`.

## Use

- **`/recap`** or **Generate session recap** in the command palette (`ctrl+p`) generates one on demand.
- After three user turns, leaving a session tab inactive for three minutes generates one automatically.
- Blurring the terminal makes every open tab inactive; switching tabs does not cancel generation already underway.
- **Dismiss session recap** in the palette, clicking the recap, or sending new input dismisses it.

Generation is read-only: it uses your session's model and history for one side request, and nothing enters the transcript.
Recaps and in-flight generation survive navigation between tabs for the lifetime of the TUI process.
The latest recapped user message is persisted across TUI restarts, so reopening an unchanged session does not generate another recap. A new user message is required before automatic generation becomes eligible again.

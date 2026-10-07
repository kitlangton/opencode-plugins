---
"@kitlangton/opencode-pr-tracker": patch
"@kitlangton/opencode-session-recap": patch
---

Fix loading with the current OpenCode V2 TUI. Expose terminal entrypoints, share
the host rendering runtime, and use the current plugin API, events, and theme
tokens. Keep GitHub lookups scoped to each session's directory when loaded as a
global CLI plugin.

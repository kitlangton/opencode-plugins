# OpenCode Plugins

Personal OpenCode V2 plugins.

## Plugins

- [`@kitlangton/opencode-session-recap`](./packages/session-recap): transient session recaps above the composer.

Each plugin is independently versioned and published to npm.

## Publish

```bash
npm login --auth-type=web
bun run release
```

## Share

Coworkers add the package to `opencode.jsonc`:

```jsonc
{
  "plugins": ["@kitlangton/opencode-session-recap"]
}
```

Restart OpenCode after changing the plugin list. Requires an OpenCode V2 `next` release containing `session.generate` and `session.composer.top`.

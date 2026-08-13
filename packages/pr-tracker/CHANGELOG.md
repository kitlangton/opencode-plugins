# @kitlangton/opencode-pr-tracker

## 0.2.0

### Minor Changes

- e33cc20: Discover the checked-out branch's pull request and track pull requests changed through `gh pr edit` or `gh api`.

### Patch Changes

- adb52e7: Recover pull requests after session messages hydrate and revalidate stale status when returning to a session tab.

## 0.1.1

### Patch Changes

- 43da614: Keep pull requests scoped to the root session that created them and remove the current-branch prompt footer indicator.

## 0.1.0

### Minor Changes

- 66ec23a: Add the session-aware pull request tracker and update session recap to load its TUI implementation through the current hierarchical slot API.

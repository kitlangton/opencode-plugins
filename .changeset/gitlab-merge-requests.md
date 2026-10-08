---
"@kitlangton/opencode-pr-tracker": minor
---

Track GitLab merge requests alongside GitHub pull requests. Use authenticated
glab lookups for GitLab.com and self-managed instances, adopt merge requests from
successful create/update commands, and show draft and pipeline status. Refresh
the active session's request and CI state every 45 seconds without polling
inactive sessions.

Recover requests from complete, paginated session-family history rather than
only cached messages, so requests created by unopened subagents appear too.
Keep explicit request URL lookups working after their original worktree is
removed, without guessing a repository for numeric references.
Recover all open requests from direct create/update commands with quoted or
shell-generated descriptions, without evaluating shell code or adopting URLs
from the description text.

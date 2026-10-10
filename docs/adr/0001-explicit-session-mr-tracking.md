# Explicit session MR tracking

## Status

Accepted.

## Context

A detached worktree has no branch for MR lookup. MR updates made inside Python
or other scripts cannot be identified safely from shell history. Adopting URLs
from read-only research would attach unrelated requests to a session.

## Decision

Add `/mr-track <URL>` as an explicit TUI action. Validate the MR with the existing
authenticated `glab` lookup before saving its canonical URL. Store manual links
in the plugin's durable `manual-mrs-v1` store, keyed by the session family's root
ID. Keep this store separate from automatically recovered, in-memory links.

## Consequences

Links survive TUI restarts without broadening automatic command detection. The
sidebar refreshes their current GitLab state and hides closed or merged MRs.
Links are local to the CLI storage and are not part of server session exports.
There is no command to remove an explicit link yet.

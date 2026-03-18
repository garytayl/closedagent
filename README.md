# closedagent

MCP tool server for:

- Vercel deployment status checks
- Vercel deployment logs retrieval
- Git commit/push automation
- Post-push deployment monitoring

## New workflow tool

`git_commit_and_check_vercel` is designed for the core loop:

1. Commit and push repository changes.
2. Wait for the next Vercel deployment.
3. Return deployment status.
4. If deployment fails, return logs in the same response.

This is the fastest way for Cursor to surface Vercel failures immediately after a push.

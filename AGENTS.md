# AGENTS.md

Contribution rules for Codex app-server integration work in this repository.

## Safety Rules
1. Never auto-approve command execution or file-change requests.
2. Never add fallback logic that silently chooses approval decisions.
3. Approval decisions must come from explicit user action in the UI flow.

## Claude Compatibility Rules
1. Preserve `pixelAgents.runtime = claude` behavior as the compatibility baseline.
2. Any Codex or mixed-mode change must keep Claude agent create/focus/close/prompt flows working.
3. Do not break Claude persistence/restore while adding Codex persistence (`pixel-agents.agents.v2`).

## Milestone-Sized PR Rules
1. Keep PRs scoped to one milestone gate at a time (M0-M8).
2. Include milestone ID in the PR title or description.
3. Include an "Out of scope" list so cross-milestone work does not creep in.
4. Include rollback notes for runtime routing changes.

## Required Tests (Transport, Client, Routing)
Any PR that changes one or more of these files must include corresponding tests:
- `src/codex/jsonRpcTransport.ts`
- `src/codex/appServerClient.ts`
- `src/codex/runtime.ts`
- `src/PixelAgentsViewProvider.ts`
- `src/runtime/runtimeManager.ts`

Required coverage:
1. Transport parsing tests
   - `parseJsonLinesChunk` handles partial chunks, multiple JSON lines, and empty lines.
   - Malformed JSON line handling does not break subsequent message processing.
2. JSON-RPC client routing tests
   - Correct classification of notification vs server request vs response.
   - Pending request resolution/rejection, including process-exit rejection.
3. Runtime mode routing tests
   - `claude`: `openClaude` goes to Claude runtime.
   - `codex`: `openClaude` routes to Codex runtime.
   - `mixed`: `openClaude` (Claude) and `openCodex` (Codex) both work.
4. Approval routing tests
   - Server approval requests map to the correct agent/thread.
   - Approval resolution clears pending request and permission state.

If automated tests are not yet available for the touched path, the PR must update `docs/codex-integration/ACCEPTANCE_SCRIPTS.md` with equivalent manual coverage and script IDs.

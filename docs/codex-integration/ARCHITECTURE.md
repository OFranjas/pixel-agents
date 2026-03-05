# Codex App-Server Integration Architecture

This document describes the current integration shape in this repository and the target boundaries for Milestones M0-M8.

## Runtime Provider Architecture

Control flow:
1. `src/extension.ts` creates `PixelAgentsViewProvider`.
2. `PixelAgentsViewProvider` reads runtime settings from `src/runtime/runtimeManager.ts`.
3. Provider routes actions to:
   - `ClaudeJsonlRuntime` (`src/runtime/claudeJsonlRuntime.ts`), or
   - `CodexAppServerRuntime` (`src/codex/runtime.ts`), or both in `mixed` mode.
4. Runtime emits `RuntimeEvent` (`src/runtime/types.ts`).
5. Provider maps events to webview messages consumed by `webview-ui/src/hooks/useExtensionMessages.ts`.

Runtime modes (`pixelAgents.runtime`):
- `claude`: Claude JSONL runtime only.
- `codex`: Codex app-server runtime only.
- `mixed`: both runtimes enabled; UI can create either runtime agent.

## Module Boundaries

- `src/runtime/runtimeManager.ts`
  - Owns runtime configuration and persisted agent v2 schema migration.
  - Must stay side-effect-light and deterministic.
- `src/runtime/claudeJsonlRuntime.ts`
  - Compatibility wrapper over existing Claude terminal/JSONL logic.
  - Should not take Codex transport dependencies.
- `src/codex/jsonRpcTransport.ts`
  - Process lifecycle + newline-delimited JSON-RPC framing.
  - No UI/state decisions.
- `src/codex/appServerClient.ts`
  - JSON-RPC request/response plumbing and message classification.
  - No webview event mapping.
- `src/codex/runtime.ts`
  - Codex thread/agent state and protocol-to-`RuntimeEvent` mapping.
  - No direct React/webview state handling.
- `src/PixelAgentsViewProvider.ts`
  - Runtime orchestration, persistence writes, and webview bridge.
  - No transport parsing logic.
- `webview-ui/src/hooks/useExtensionMessages.ts`
  - UI state reducer for extension events.
  - No app-server protocol parsing.

## State Model

Persistent state:
- Workspace key `pixel-agents.agents.v2` stores `PersistedRuntimeAgentV2` entries.
- `runtime` discriminator (`claude` or `codex`) separates transport-specific fields.

In-memory Codex runtime state (`src/codex/runtime.ts`):
- `agentById`: agentId -> thread state.
- `threadToAgentId`: threadId -> agentId.
- `pendingRequestToAgent`: approval request id -> agentId.
- `activeTurnId` per agent for turn lifecycle tracking.

In-memory provider state (`src/PixelAgentsViewProvider.ts`):
- Shared `nextAgentId` allocator across runtimes.
- Claude runtime maps/timers (existing behavior).
- `persistedAgentsV2` for cross-session restore.

UI state (`useExtensionMessages`):
- Agent/tool/status/message/output/diff/approval maps keyed by agent ID.
- Runtime mode reflected by `settingsLoaded` message.

## Event Mapping (Codex -> RuntimeEvent -> Webview)

- `turn/started` -> `agentStatus(active)` -> `agentStatus`
- `turn/completed` -> `agentStatus(waiting)` + `agentToolPermissionClear` -> `agentStatus`, `agentToolPermissionClear`
- `item/started` (`agentMessage`) -> `agentMessageStart` -> `agentMessageStart`
- `item/started` (`commandExecution`/`fileChange`/`collabAgentToolCall`) -> `agentToolStart` -> `agentToolStart`
- `item/completed` (`agentMessage`) -> `agentMessageDone` -> `agentMessageDone`
- `item/completed` (`commandExecution`/`fileChange`/`collabAgentToolCall`) -> `agentToolDone` -> `agentToolDone`
- `item/agentMessage/delta` -> `agentMessageDelta` -> `agentMessageDelta`
- `item/commandExecution/outputDelta` -> `agentCommandOutputDelta` -> `agentCommandOutputDelta`
- `item/fileChange/outputDelta` -> `agentFileChangeOutputDelta` -> `agentFileChangeOutputDelta`
- `turn/diff/updated` -> `agentDiffUpdated` -> `agentDiffUpdated`
- server request `item/*/requestApproval` -> `agentToolPermission` + `agentApprovalRequested` -> `agentToolPermission`, `agentApprovalRequested`
- `serverRequest/resolved` -> `agentApprovalResolved` + `agentToolPermissionClear` -> `agentApprovalResolved`, `agentToolPermissionClear`

Spawned sub-agent mapping:
- `collabAgentToolCall` completion with `tool=spawnAgent` and `receiverThreadIds`:
  - create local agent IDs,
  - emit `agentCreated` + `spawnedAgent`,
  - provider persists and forwards `subagentLinked` to webview.

## Current Constraints (As Observed)

1. Transport/client/routing automated tests are not yet part of repo scripts.
2. `agentToolsClear` exists in `RuntimeEvent` but is not currently emitted by Codex runtime path.
3. Diagnostics are currently output-channel based (`Codex Diagnostics`) rather than structured telemetry.

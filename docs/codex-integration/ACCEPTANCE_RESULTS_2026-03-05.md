# Acceptance Results (2026-03-05)

Environment:
- Workspace: `/Users/franjas/Dev/Personal/Pixel-Agents-Codex`
- Date: 2026-03-05
- Codex CLI: `codex-cli 0.101.0`
- Validation style: execute each milestone script category with available local/CLI coverage; mark UI-only checks as blocked in this headless environment.

## M0

Status: PASS (local validation)

Evidence:
1. Planning artifacts exist:
   - `AGENTS.md`
   - `docs/codex-integration/ARCHITECTURE.md`
   - `docs/codex-integration/MILESTONES.md`
   - `docs/codex-integration/ACCEPTANCE_SCRIPTS.md`
   - `docs/codex-integration/OWNERSHIP.md`
2. Build gate passes:
   - `npm run build`

## M1

Status: PASS

Evidence:
1. Transport + client tests pass:
   - `npm test`
2. Type checks pass:
   - `npm run check-types`

## M2

Status: PASS (CLI protocol smoke)

Evidence:
1. Real `codex app-server` handshake + thread start:
   - Sent `initialize`, `initialized`, `thread/start`
   - Received JSON-RPC `result` for both initialize and thread/start
   - Received `thread/started` notification

## M3

Status: PARTIAL / BLOCKED (UI restore path requires Extension Development Host)

Validated:
1. Runtime-aware persistence code and migration path are present in:
   - `src/runtime/runtimeManager.ts`
   - `src/PixelAgentsViewProvider.ts`

Blocked here:
1. Full VS Code window reload + sprite restore interaction cannot be executed in this headless CLI session.

## M4

Status: PASS (CLI protocol smoke for turn stream)

Evidence:
1. Real `turn/start` run via app-server script:
   - `item/agentMessage/delta` observed (`ok`)
   - `turn/completed` observed

## M5

Status: PARTIAL

Validated:
1. Protocol + runtime approval handling implemented and wired:
   - server request routing in `src/codex/runtime.ts`
   - response plumbing in `src/codex/appServerClient.ts`
   - UI decision submission in `webview-ui/src/App.tsx`
2. Non-auto-approval policy enforced by code path (no automatic acceptance).

Blocked here:
1. Deterministic live approval prompt generation from a single automated turn is non-deterministic and was not reproducible in this session.
2. Full modal interaction in VS Code webview requires Extension Development Host.

## M6

Status: PARTIAL / BLOCKED (UI workflow)

Validated:
1. Mixed-mode controls and folder routing code paths exist in:
   - `webview-ui/src/components/BottomToolbar.tsx`
   - `webview-ui/src/App.tsx`
   - `src/PixelAgentsViewProvider.ts`

Blocked here:
1. Multi-root UI interaction and per-button behavior needs manual VS Code UI validation.

## M7

Status: PARTIAL

Validated:
1. Restart/recovery logic implemented with bounded backoff and re-resume:
   - `src/codex/runtime.ts`
2. Re-initialize-before-request logic implemented:
   - `src/codex/appServerClient.ts`
3. Diagnostics logging present for recovery lifecycle.

Blocked here:
1. End-to-end process-kill and in-panel state recovery visualization requires VS Code Extension Development Host.

## M8

Status: PARTIAL / BLOCKED (release UX gate)

Validated:
1. Build + test gates pass:
   - `npm run build`
   - `npm test`
2. Docs and guardrails are in place.

Blocked here:
1. Full tri-mode (`claude`/`codex`/`mixed`) interactive smoke checklist requires local VS Code manual run.

## Commands Executed

1. `npm test`
2. `npm run check-types`
3. `npm run build`
4. CLI protocol smoke commands against `codex app-server` for:
   - initialize/initialized/thread/start
   - turn/start streaming


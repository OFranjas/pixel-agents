# Ownership and Parallel Workstreams

This plan is for parallel delivery with minimal merge conflicts while preserving Claude compatibility.

## Workstreams

### WS-A: Transport + Protocol Client
- Files: `src/codex/jsonRpcTransport.ts`, `src/codex/appServerClient.ts`, `src/codex/protocol.ts`
- Milestones: M1, M4, M7
- Outputs:
  - framing/reconnect reliability,
  - JSON-RPC classification correctness,
  - transport/client tests.

### WS-B: Runtime Orchestration + Persistence
- Files: `src/codex/runtime.ts`, `src/runtime/runtimeManager.ts`, `src/runtime/types.ts`, `src/PixelAgentsViewProvider.ts`
- Milestones: M2, M3, M5
- Outputs:
  - deterministic routing by runtime mode,
  - restore semantics (`agents.v2`),
  - approval lifecycle correctness.

### WS-C: Webview Integration + UX
- Files: `webview-ui/src/hooks/useExtensionMessages.ts`, `webview-ui/src/components/*`, `webview-ui/src/App.tsx`
- Milestones: M4, M6
- Outputs:
  - clear runtime affordances,
  - event rendering parity,
  - mixed-mode UX polish.

### WS-D: Docs, Acceptance, Release Readiness
- Files: `AGENTS.md`, `docs/codex-integration/*`, `README.md`
- Milestones: M0, M8
- Outputs:
  - contributor guardrails,
  - acceptance scripts,
  - release documentation.

## Merge Order

1. M0 (WS-D): planning docs and guardrails.
2. M1 (WS-A): transport/client test baseline.
3. M2-M3 (WS-B): routing + persistence hardening.
4. M4 (WS-A + WS-C): event fidelity and UI integration.
5. M5 (WS-B): approval lifecycle hardening.
6. M6 (WS-C): mixed-mode UX and workspace routing.
7. M7 (WS-A + WS-B): resilience and diagnostics.
8. M8 (WS-D with all streams): release hardening + final docs.

## Conflict Hotspots

1. `src/PixelAgentsViewProvider.ts` is a high-conflict file; serialize merges for M2/M3/M5.
2. `webview-ui/src/hooks/useExtensionMessages.ts` should land after protocol event shape is stable.
3. Runtime mode labels and behavior must be validated together when changing UI + provider routing.

## Definition of Done Per Stream

1. Milestone gate met in `MILESTONES.md`.
2. Matching scripts in `ACCEPTANCE_SCRIPTS.md` executed and recorded in PR.
3. Claude compatibility check included in every Codex/mixed milestone PR.

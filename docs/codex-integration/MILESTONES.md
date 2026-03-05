# Codex App-Server Integration Milestones (M0-M8)

All milestones below are planned unless explicitly delivered in merged PRs.

| Milestone | Scope | Acceptance Gate |
| --- | --- | --- |
| M0 | Planning baseline: docs, rules, ownership, acceptance scripts. | `AGENTS.md` + `docs/codex-integration/*` merged; no runtime code regressions introduced. |
| M1 | Transport/client test harness and routing test scaffolding. | Required tests for transport parsing and JSON-RPC message routing exist and run in CI/local workflow. |
| M2 | Runtime bootstrap and mode routing hardening (`claude`/`codex`/`mixed`). | Agent creation and prompt routing are deterministic per mode; startup failures surface actionable errors. |
| M3 | Persistence + restore parity across runtimes (`agents.v2`). | Restarting VS Code restores Claude and Codex agents correctly in supported modes without ID collisions. |
| M4 | Event fidelity for tool/message/output/diff streams. | Codex runtime events map consistently to webview state with no dropped core event types in smoke scripts. |
| M5 | Approval lifecycle hardening (request -> decision -> resolution). | Approval prompts always bind to correct agent/thread, resolve cleanly, and never auto-approve. |
| M6 | Mixed-mode UX and workspace-folder routing polish. | `+ Agent` / `+ Codex` actions are unambiguous; folder targeting works in multi-root workspaces. |
| M7 | Resilience and observability (restart/reconnect/diagnostics). | Auto-restart and reconnect behavior validated; diagnostics are sufficient to debug transport and protocol failures. |
| M8 | Release hardening and handoff. | End-to-end acceptance scripts pass for all runtime modes; docs and rollback plan are release-ready. |

## Gate Policy

1. One milestone gate per PR.
2. A milestone is accepted only when its scripts in `ACCEPTANCE_SCRIPTS.md` pass for all listed runtime modes.
3. If scope expands, split into the next milestone PR instead of widening the gate.

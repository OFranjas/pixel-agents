# Acceptance Scripts (Manual)

These are milestone acceptance scripts for runtime modes `claude`, `codex`, and `mixed`.

For M1-M8, scripts are planned gates and may depend on commands/tests introduced in those milestones.

## Environment Setup

1. Run `npm run build`.
2. Launch extension host (VS Code `F5`).
3. Open the Pixel Agents panel.
4. For milestones that include runtime routing (`M1+`), set `pixelAgents.runtime` before each script.

## M0

- `M0-BASELINE-01` (upstream compatibility baseline)
  1. Launch panel in default runtime configuration.
  2. Click `+ Agent`.
  3. Confirm baseline Claude workflow still works.
  Pass: docs-only milestone introduces no behavioral regressions.

- `M0-DOCS-01` (planning artifacts)
  1. Open `docs/codex-integration/ARCHITECTURE.md`.
  2. Open `docs/codex-integration/MILESTONES.md`.
  3. Open `docs/codex-integration/ACCEPTANCE_SCRIPTS.md`.
  4. Open `docs/codex-integration/OWNERSHIP.md`.
  Pass: planning docs required by M0 are present and readable in-repo.

## M1

- `M1-CLAUDE-01` (`claude`)
  1. Run milestone test command for routing (`npm run test:runtime-routing`, once added).
  2. Verify Claude-mode routing assertions pass.
  Pass: routing test suite includes claude mode coverage.

- `M1-CODEX-01` (`codex`)
  1. Run milestone transport/client tests (`npm run test:codex-transport`, once added).
  2. Verify parser/client classification tests pass.
  Pass: transport/client routing tests pass.

- `M1-MIXED-01` (`mixed`)
  1. Run full runtime routing tests.
  2. Verify mixed-mode branch assertions pass.
  Pass: mixed-mode routing tests pass.

## M2

- `M2-CLAUDE-01` (`claude`)
  1. Launch with `claude` mode.
  2. Create, focus, prompt, and close one agent.
  Pass: all actions route only to Claude runtime.

- `M2-CODEX-01` (`codex`)
  1. Launch with `codex` mode.
  2. Create one agent and send prompt.
  3. Inspect `Codex Diagnostics` channel for initialize and event logs.
  Pass: app-server initializes and routes all agent actions via Codex runtime.

- `M2-MIXED-01` (`mixed`)
  1. Launch with `mixed` mode.
  2. Create one `+ Agent` and one `+ Codex` agent.
  Pass: each action routes to intended runtime path.

## M3

- `M3-CLAUDE-01` (`claude`)
  1. Create Claude agent and restart extension host.
  2. Reopen panel.
  Pass: Claude agent restore path remains functional.

- `M3-CODEX-01` (`codex`)
  1. Create Codex agent and restart extension host.
  2. Reopen panel.
  Pass: persisted Codex thread restores without duplicate IDs.

- `M3-MIXED-01` (`mixed`)
  1. Create one Claude and one Codex agent.
  2. Restart extension host and reopen panel.
  Pass: both runtimes restore, IDs remain stable, no collision.

## M4

- `M4-CLAUDE-01` (`claude`)
  1. Run a Claude turn that emits tool activity.
  Pass: UI still shows expected Claude tool/status progression.

- `M4-CODEX-01` (`codex`)
  1. Run a Codex turn with command output and file change output.
  2. Observe debug view stream updates.
  Pass: tool start/done, output deltas, and diff updates appear in order.

- `M4-MIXED-01` (`mixed`)
  1. Run one turn in each runtime.
  Pass: event rendering is correct for both runtimes in one session.

## M5

- `M5-CLAUDE-01` (`claude`)
  1. Run a normal Claude session.
  Pass: no Codex approval UI leaks into Claude-only runtime.

- `M5-CODEX-01` (`codex`)
  1. Trigger an approval-required command/file change.
  2. Submit explicit decision from UI.
  Pass: request binds to correct agent, resolves once, and clears permission state.

- `M5-MIXED-01` (`mixed`)
  1. Trigger Codex approval while Claude agent is also active.
  Pass: approval appears only on relevant Codex agent.

## M6

- `M6-CLAUDE-01` (`claude`)
  1. In multi-root workspace, create Claude agent from folder picker.
  Pass: selected folder is respected for Claude launch path.

- `M6-CODEX-01` (`codex`)
  1. In multi-root workspace, create Codex agent from folder picker path.
  Pass: selected folder is used as Codex `cwd`.

- `M6-MIXED-01` (`mixed`)
  1. Create one Claude and one Codex agent from different folders.
  Pass: folder routing remains correct per runtime action.

## M7

- `M7-CLAUDE-01` (`claude`)
  1. Run standard Claude flow with diagnostics open.
  Pass: Claude compatibility unchanged while resilience updates are present.

- `M7-CODEX-01` (`codex`)
  1. Start Codex runtime, then force app-server exit.
  2. Wait for auto-restart interval.
  Pass: transport restarts (when enabled) and diagnostics clearly show failure/recovery.

- `M7-MIXED-01` (`mixed`)
  1. Run Claude + Codex agents, then restart Codex process.
  Pass: Codex path recovers without breaking active Claude UI state.

## M8

- `M8-CLAUDE-01` (`claude`)
  1. Execute full claude smoke checklist.
  Pass: release candidate has no Claude regressions.

- `M8-CODEX-01` (`codex`)
  1. Execute full codex smoke checklist including approval flow.
  Pass: release candidate meets codex runtime acceptance gate.

- `M8-MIXED-01` (`mixed`)
  1. Execute full mixed-mode checklist with both agent types.
  Pass: release candidate is stable in mixed mode.

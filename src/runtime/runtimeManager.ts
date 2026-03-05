import * as vscode from 'vscode';
import {
	CONFIG_CODEX_AUTO_RESTART,
	CONFIG_CODEX_COMMAND,
	CONFIG_CODEX_EXPERIMENTAL_API,
	CONFIG_RUNTIME,
	WORKSPACE_KEY_AGENTS,
	WORKSPACE_KEY_AGENTS_V2,
} from '../constants.js';
import type { PersistedAgent } from '../types.js';
import type { PersistedRuntimeAgentV2, RuntimeKind } from './types.js';
import { normalizeRuntimeMode, type RuntimeMode } from './modeRouting.js';
export type { RuntimeMode } from './modeRouting.js';

export interface RuntimeSettings {
	mode: RuntimeMode;
	codexCommand: string;
	codexExperimentalApi: boolean;
	codexAutoRestart: boolean;
}

export function readRuntimeSettings(): RuntimeSettings {
	const cfg = vscode.workspace.getConfiguration();
	const modeValue = cfg.get<string>(CONFIG_RUNTIME, 'claude');
	const mode = normalizeRuntimeMode(modeValue);
	return {
		mode,
		codexCommand: cfg.get<string>(CONFIG_CODEX_COMMAND, 'codex app-server'),
		codexExperimentalApi: cfg.get<boolean>(CONFIG_CODEX_EXPERIMENTAL_API, false),
		codexAutoRestart: cfg.get<boolean>(CONFIG_CODEX_AUTO_RESTART, true),
	};
}

export async function loadPersistedAgentsV2(
	context: vscode.ExtensionContext,
): Promise<PersistedRuntimeAgentV2[]> {
	const existingV2 = context.workspaceState.get<PersistedRuntimeAgentV2[]>(WORKSPACE_KEY_AGENTS_V2);
	if (existingV2 && Array.isArray(existingV2)) {
		return existingV2;
	}

	// Migrate v1 entries lazily.
	const v1 = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	const migrated = v1.map<PersistedRuntimeAgentV2>((entry: PersistedAgent) => ({
		id: entry.id,
		runtime: 'claude',
		folderName: entry.folderName,
		claude: {
			terminalName: entry.terminalName,
			jsonlFile: entry.jsonlFile,
			projectDir: entry.projectDir,
		},
	}));
	await context.workspaceState.update(WORKSPACE_KEY_AGENTS_V2, migrated);
	return migrated;
}

export async function savePersistedAgentsV2(
	context: vscode.ExtensionContext,
	agents: PersistedRuntimeAgentV2[],
): Promise<void> {
	await context.workspaceState.update(WORKSPACE_KEY_AGENTS_V2, agents);
}

export function upsertPersistedCodexAgent(
	agents: PersistedRuntimeAgentV2[],
	agentId: number,
	threadId: string,
	folderName?: string,
	parentAgentId?: number,
	parentRuntimeRefId?: string,
	status?: string,
): PersistedRuntimeAgentV2[] {
	const next = agents.filter((a) => a.id !== agentId);
	next.push({
		id: agentId,
		runtime: 'codex',
		folderName,
		parentAgentId,
		parentRuntimeRefId,
		codex: {
			threadId,
			status,
		},
	});
	next.sort((a, b) => a.id - b.id);
	return next;
}

export function removePersistedAgent(
	agents: PersistedRuntimeAgentV2[],
	agentId: number,
): PersistedRuntimeAgentV2[] {
	return agents.filter((agent) => agent.id !== agentId);
}

export function getPersistedRuntime(agent: PersistedRuntimeAgentV2): RuntimeKind {
	return agent.runtime === 'codex' ? 'codex' : 'claude';
}

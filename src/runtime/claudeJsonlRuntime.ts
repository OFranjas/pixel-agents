import * as fs from 'fs';
import type * as vscode from 'vscode';
import type { AgentState } from '../types.js';
import {
	launchNewTerminal,
	persistAgents,
	removeAgent,
	restoreAgents,
	sendExistingAgents,
} from '../agentManager.js';
import type { RuntimeProvider } from './types.js';

export interface ClaudeJsonlRuntimeRefs {
	context: vscode.ExtensionContext;
	nextAgentId: { current: number };
	nextTerminalIndex: { current: number };
	agents: Map<number, AgentState>;
	activeAgentId: { current: number | null };
	knownJsonlFiles: Set<string>;
	fileWatchers: Map<number, fs.FSWatcher>;
	pollingTimers: Map<number, ReturnType<typeof setInterval>>;
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
	projectScanTimer: { current: ReturnType<typeof setInterval> | null };
	getWebview: () => vscode.Webview | undefined;
	onPersist?: () => void;
}

/**
 * Compatibility provider that wraps the existing Claude JSONL runtime logic.
 */
export class ClaudeJsonlRuntime implements RuntimeProvider {
	readonly kind = 'claude' as const;

	constructor(private readonly refs: ClaudeJsonlRuntimeRefs) {}

	async initialize(): Promise<void> {}

	async dispose(): Promise<void> {
		for (const id of [...this.refs.agents.keys()]) {
			removeAgent(
				id,
				this.refs.agents,
				this.refs.fileWatchers,
				this.refs.pollingTimers,
				this.refs.waitingTimers,
				this.refs.permissionTimers,
				this.refs.jsonlPollTimers,
				this.persistAgents,
			);
		}
	}

	async createAgent(folderPath?: string): Promise<void> {
		await launchNewTerminal(
			this.refs.nextAgentId,
			this.refs.nextTerminalIndex,
			this.refs.agents,
			this.refs.activeAgentId,
			this.refs.knownJsonlFiles,
			this.refs.fileWatchers,
			this.refs.pollingTimers,
			this.refs.waitingTimers,
			this.refs.permissionTimers,
			this.refs.jsonlPollTimers,
			this.refs.projectScanTimer,
			this.refs.getWebview(),
			this.persistAgents,
			folderPath,
		);
	}

	restore(): void {
		restoreAgents(
			this.refs.context,
			this.refs.nextAgentId,
			this.refs.nextTerminalIndex,
			this.refs.agents,
			this.refs.knownJsonlFiles,
			this.refs.fileWatchers,
			this.refs.pollingTimers,
			this.refs.waitingTimers,
			this.refs.permissionTimers,
			this.refs.jsonlPollTimers,
			this.refs.projectScanTimer,
			this.refs.activeAgentId,
			this.refs.getWebview(),
			this.persistAgents,
		);
	}

	sendExistingAgents(): void {
		sendExistingAgents(this.refs.agents, this.refs.context, this.refs.getWebview());
	}

	focusAgent(agentId: number): boolean {
		const agent = this.refs.agents.get(agentId);
		if (!agent) return false;
		agent.terminalRef.show();
		return true;
	}

	closeAgent(agentId: number): boolean {
		const agent = this.refs.agents.get(agentId);
		if (!agent) return false;
		agent.terminalRef.dispose();
		return true;
	}

	sendPrompt(agentId: number, text: string): boolean {
		const agent = this.refs.agents.get(agentId);
		if (!agent) return false;
		agent.terminalRef.sendText(text);
		return true;
	}

	hasAgent(agentId: number): boolean {
		return this.refs.agents.has(agentId);
	}

	private readonly persistAgents = (): void => {
		persistAgents(this.refs.agents, this.refs.context);
		this.refs.onPersist?.();
	};
}

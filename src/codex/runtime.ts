import type * as vscode from 'vscode';
import {
	CodexAppServerClient,
	isAgentMessageDelta,
	isCommandOutputDelta,
	isDiffUpdated,
	isFileChangeOutputDelta,
	isItemCompleted,
	isItemStarted,
	isServerRequestResolved,
	isTurnCompleted,
	isTurnStarted,
} from './appServerClient.js';
import { CodexJsonRpcTransport } from './jsonRpcTransport.js';
import type {
	InitializeParams,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcId,
	ThreadStartResponse,
	TurnStartResponse,
} from './protocol.js';
import type { RuntimeEvent, RuntimeProvider } from '../runtime/types.js';

interface CodexRuntimeAgentState {
	agentId: number;
	threadId: string;
	folderName?: string;
	parentAgentId?: number;
	parentRuntimeRefId?: string;
	activeTurnId: string | null;
}

export interface CodexAppServerRuntimeOptions {
	command: string;
	experimentalApi: boolean;
	autoRestart: boolean;
	outputChannel: vscode.OutputChannel;
	onEvent: (event: RuntimeEvent) => void;
	allocateAgentId: () => number;
}

const RECOVERY_MAX_ATTEMPTS = 6;
const RECOVERY_MAX_BACKOFF_MS = 8_000;

function toLogString(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Runtime provider backed by `codex app-server`.
 */
export class CodexAppServerRuntime implements RuntimeProvider {
	readonly kind = 'codex' as const;

	private readonly transport: CodexJsonRpcTransport;
	private readonly client: CodexAppServerClient;
	private readonly agentById = new Map<number, CodexRuntimeAgentState>();
	private readonly threadToAgentId = new Map<string, number>();
	private readonly pendingRequestToAgent = new Map<JsonRpcId, number>();
	private readonly initializeParams: InitializeParams;
	private ready = false;
	private connected = false;
	private disposed = false;
	private recoveryPromise: Promise<void> | null = null;
	private transportExitCount = 0;

	constructor(private readonly options: CodexAppServerRuntimeOptions) {
		this.initializeParams = {
			clientInfo: {
				name: 'pixel_agents',
				title: 'Pixel Agents',
				version: '0.0.0',
			},
			capabilities: {
				experimentalApi: this.options.experimentalApi,
			},
		};

		this.transport = new CodexJsonRpcTransport({
			command: options.command,
			autoRestart: options.autoRestart,
		});
		this.client = new CodexAppServerClient(this.transport);

		this.client.on('notification', this.onNotification);
		this.client.on('serverRequest', this.onServerRequest);
		this.client.on('stderr', (line) => {
			this.options.outputChannel.appendLine(line);
		});
		this.client.on('error', (error) => {
			this.options.outputChannel.appendLine(`[codex:error] ${error.message}`);
		});
		this.client.on('exit', this.onTransportExit);
	}

	async initialize(): Promise<void> {
		this.disposed = false;
		this.client.start();
		await this.client.ensureInitialized(this.initializeParams);
		this.ready = true;
		this.connected = true;
		this.options.outputChannel.appendLine('[codex:state] initialized app-server client; runtime ready');
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.ready = false;
		this.connected = false;
		this.agentById.clear();
		this.threadToAgentId.clear();
		this.pendingRequestToAgent.clear();
		this.client.stop();
	}

	isInitialized(): boolean {
		return this.ready;
	}

	listAgentStates(): CodexRuntimeAgentState[] {
		return [...this.agentById.values()];
	}

	getAgentState(agentId: number): CodexRuntimeAgentState | undefined {
		return this.agentById.get(agentId);
	}

	async createAgent(agentId: number, cwd?: string, folderName?: string): Promise<{ threadId: string }> {
		await this.ensureReady();
		const response = await this.client.threadStart({
			cwd: cwd || null,
		});
		return this.registerAgentFromThreadStart(agentId, response, folderName);
	}

	async restoreAgent(agentId: number, threadId: string, cwd?: string, folderName?: string): Promise<void> {
		await this.ensureReady();
		const params: { threadId: string; cwd?: string | null } = { threadId };
		if (cwd) {
			params.cwd = cwd;
		}
		await this.client.threadResume(params);
		this.registerAgent(agentId, threadId, folderName);
		this.options.onEvent({ type: 'agentCreated', id: agentId, folderName });
	}

	async closeAgent(agentId: number, archiveThread = false): Promise<void> {
		const agent = this.agentById.get(agentId);
		if (!agent) {
			return;
		}
		this.clearPendingApprovalsForAgent(agentId, 'agent close');
		if (archiveThread) {
			await this.ensureReady();
			try {
				await this.client.threadArchive({ threadId: agent.threadId });
			} catch (error) {
				this.options.outputChannel.appendLine(`[codex] failed to archive ${agent.threadId}: ${String(error)}`);
			}
		}
		this.unregisterAgent(agentId);
		this.options.onEvent({ type: 'agentClosed', id: agentId });
	}

	focusAgent(agentId: number): void {
		if (!this.agentById.has(agentId)) return;
		this.options.onEvent({ type: 'agentSelected', id: agentId });
	}

	async sendPrompt(agentId: number, text: string): Promise<TurnStartResponse> {
		await this.ensureReady();
		const agent = this.agentById.get(agentId);
		if (!agent) {
			throw new Error(`Unknown Codex agent: ${agentId}`);
		}
		const response = await this.client.turnStart({
			threadId: agent.threadId,
			input: [{ type: 'text', text }],
		});
		return response;
	}

	async submitApprovalDecision(requestId: JsonRpcId, decision: unknown): Promise<void> {
		await this.ensureReady();
		this.client.respond(requestId, { decision });
	}

	private async ensureReady(): Promise<void> {
		if (!this.ready) {
			throw new Error('Codex runtime not initialized');
		}
		if (!this.connected) {
			if (!this.recoveryPromise) {
				this.startRecovery();
			}
			if (this.recoveryPromise) {
				await this.recoveryPromise;
			}
		}
		if (!this.connected) {
			throw new Error('Codex runtime is recovering from app-server restart');
		}
	}

	private registerAgentFromThreadStart(
		agentId: number,
		response: ThreadStartResponse,
		folderName?: string,
	): { threadId: string } {
		const threadId = response.thread.id;
		this.registerAgent(agentId, threadId, folderName);
		this.options.onEvent({ type: 'agentCreated', id: agentId, folderName });
		return { threadId };
	}

	private registerAgent(agentId: number, threadId: string, folderName?: string): void {
		const state: CodexRuntimeAgentState = {
			agentId,
			threadId,
			folderName,
			activeTurnId: null,
		};
		this.agentById.set(agentId, state);
		this.threadToAgentId.set(threadId, agentId);
	}

	private unregisterAgent(agentId: number): void {
		const state = this.agentById.get(agentId);
		if (!state) return;
		this.agentById.delete(agentId);
		this.threadToAgentId.delete(state.threadId);
	}

	private readonly onTransportExit = (code: number | null, signal: NodeJS.Signals | null): void => {
		if (this.disposed || !this.ready) {
			return;
		}
		this.transportExitCount += 1;
		this.connected = false;
		this.options.outputChannel.appendLine(
			`[codex:state] transport exited (code=${String(code)}, signal=${String(signal)}); runtime not ready`,
		);
		this.clearPendingApprovals('transport exit');
		this.startRecovery();
	};

	private startRecovery(): void {
		if (this.recoveryPromise || this.disposed || !this.ready) {
			if (this.recoveryPromise) {
				this.options.outputChannel.appendLine('[codex:recovery] recovery already in progress');
			}
			return;
		}
		const exitCountSnapshot = this.transportExitCount;
		this.options.outputChannel.appendLine('[codex:recovery] starting reconnect/resubscribe flow');
		this.recoveryPromise = this.recoverFromRestart(exitCountSnapshot)
			.catch((error) => {
				this.options.outputChannel.appendLine(`[codex:recovery] unexpected recovery error: ${formatError(error)}`);
			})
			.finally(() => {
				this.recoveryPromise = null;
				if (!this.connected && !this.disposed && this.ready && this.transportExitCount > exitCountSnapshot) {
					this.startRecovery();
				}
			});
	}

	private async recoverFromRestart(exitCountSnapshot: number): Promise<void> {
		for (let attempt = 1; attempt <= RECOVERY_MAX_ATTEMPTS; attempt += 1) {
			if (this.disposed || !this.ready || this.transportExitCount !== exitCountSnapshot) {
				return;
			}

			if (attempt > 1) {
				const backoffMs = Math.min(500 * 2 ** (attempt - 2), RECOVERY_MAX_BACKOFF_MS);
				this.options.outputChannel.appendLine(
					`[codex:recovery] attempt ${attempt}/${RECOVERY_MAX_ATTEMPTS} in ${backoffMs}ms`,
				);
				await sleep(backoffMs);
				if (this.disposed || !this.ready || this.transportExitCount !== exitCountSnapshot) {
					return;
				}
			} else {
				this.options.outputChannel.appendLine(
					`[codex:recovery] attempt 1/${RECOVERY_MAX_ATTEMPTS}`,
				);
			}

			try {
				await this.client.ensureInitialized(this.initializeParams);
				await this.resumeKnownThreads();
				if (this.transportExitCount !== exitCountSnapshot) {
					return;
				}
				this.connected = true;
				this.options.outputChannel.appendLine(
					`[codex:state] runtime ready after recovery (attempt ${attempt}/${RECOVERY_MAX_ATTEMPTS})`,
				);
				return;
			} catch (error) {
				this.options.outputChannel.appendLine(
					`[codex:recovery] attempt ${attempt}/${RECOVERY_MAX_ATTEMPTS} failed: ${formatError(error)}`,
				);
			}
		}

		this.options.outputChannel.appendLine(
			`[codex:state] recovery exhausted after ${RECOVERY_MAX_ATTEMPTS} attempts; runtime still not ready`,
		);
	}

	private async resumeKnownThreads(): Promise<void> {
		const agents = [...this.agentById.values()];
		if (agents.length === 0) {
			this.options.outputChannel.appendLine('[codex:recovery] no active threads to resubscribe');
			return;
		}

		let resumed = 0;
		let failed = 0;
		this.options.outputChannel.appendLine(`[codex:recovery] resubscribing ${agents.length} thread(s)`);
		for (const agent of agents) {
			try {
				await this.client.threadResume({ threadId: agent.threadId });
				resumed += 1;
			} catch (error) {
				failed += 1;
				this.options.outputChannel.appendLine(
					`[codex:recovery] failed to resubscribe thread ${agent.threadId}: ${formatError(error)}`,
				);
			}
		}
		this.options.outputChannel.appendLine(`[codex:recovery] resubscribe complete (resumed=${resumed}, failed=${failed})`);
	}

	private clearPendingApprovals(reason: string): void {
		if (this.pendingRequestToAgent.size === 0) {
			return;
		}
		const pendingEntries = [...this.pendingRequestToAgent.entries()];
		const agentIds = new Set<number>(pendingEntries.map(([, agentId]) => agentId));
		const pendingCount = this.pendingRequestToAgent.size;
		this.pendingRequestToAgent.clear();
		for (const [requestId, agentId] of pendingEntries) {
			this.options.onEvent({
				type: 'agentApprovalResolved',
				id: agentId,
				requestId,
			});
		}
		for (const agentId of agentIds) {
			this.options.onEvent({ type: 'agentToolPermissionClear', id: agentId });
		}
		this.options.outputChannel.appendLine(
			`[codex:state] cleared ${pendingCount} pending approval request(s) due to ${reason}`,
		);
	}

	private clearPendingApprovalsForAgent(agentId: number, reason: string): void {
		const pendingEntries = [...this.pendingRequestToAgent.entries()].filter(
			([, pendingAgentId]) => pendingAgentId === agentId,
		);
		if (pendingEntries.length === 0) {
			return;
		}
		for (const [requestId] of pendingEntries) {
			this.pendingRequestToAgent.delete(requestId);
			this.options.onEvent({
				type: 'agentApprovalResolved',
				id: agentId,
				requestId,
			});
		}
		this.options.onEvent({ type: 'agentToolPermissionClear', id: agentId });
		this.options.outputChannel.appendLine(
			`[codex:state] cleared ${pendingEntries.length} pending approval request(s) for agent ${agentId} due to ${reason}`,
		);
	}

	private readonly onNotification = (notification: JsonRpcNotification): void => {
		this.options.outputChannel.appendLine(`[codex:event] ${toLogString(notification)}`);
		if (isTurnStarted(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			const state = this.agentById.get(agentId);
			if (state) {
				state.activeTurnId = params.turn.id;
			}
			this.options.onEvent({ type: 'agentStatus', id: agentId, status: 'active' });
			return;
		}

		if (isTurnCompleted(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			const state = this.agentById.get(agentId);
			if (state) {
				state.activeTurnId = null;
			}
			this.clearPendingApprovalsForAgent(agentId, 'turn completed');
			this.options.onEvent({ type: 'agentStatus', id: agentId, status: 'waiting' });
			this.options.onEvent({ type: 'agentToolPermissionClear', id: agentId });
			return;
		}

		if (isItemStarted(notification)) {
			const params = notification.params;
			if (!params) return;
			this.handleItemStarted(params.threadId, params.item);
			return;
		}

		if (isItemCompleted(notification)) {
			const params = notification.params;
			if (!params) return;
			this.handleItemCompleted(params.threadId, params.item);
			return;
		}

		if (isAgentMessageDelta(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			this.options.onEvent({
				type: 'agentMessageDelta',
				id: agentId,
				itemId: params.itemId,
				delta: params.delta,
			});
			return;
		}

		if (isCommandOutputDelta(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			this.options.onEvent({
				type: 'agentCommandOutputDelta',
				id: agentId,
				itemId: params.itemId,
				delta: params.delta,
			});
			return;
		}

		if (isFileChangeOutputDelta(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			this.options.onEvent({
				type: 'agentFileChangeOutputDelta',
				id: agentId,
				itemId: params.itemId,
				delta: params.delta,
			});
			return;
		}

		if (isDiffUpdated(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.threadToAgentId.get(params.threadId);
			if (agentId === undefined) return;
			this.options.onEvent({
				type: 'agentDiffUpdated',
				id: agentId,
				turnId: params.turnId,
				diff: params.diff,
			});
			return;
		}

		if (isServerRequestResolved(notification)) {
			const params = notification.params;
			if (!params) return;
			const agentId = this.pendingRequestToAgent.get(params.requestId);
			if (agentId === undefined) return;
			this.pendingRequestToAgent.delete(params.requestId);
			this.options.onEvent({
				type: 'agentApprovalResolved',
				id: agentId,
				requestId: params.requestId,
			});
			this.options.onEvent({ type: 'agentToolPermissionClear', id: agentId });
		}
	};

	private readonly onServerRequest = (request: JsonRpcRequest): void => {
		const method = request.method;
		if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
			const params = (request.params || {}) as Record<string, unknown>;
			const threadId = typeof params.threadId === 'string' ? params.threadId : null;
			if (!threadId) {
				this.client.respondError(request.id, -32602, 'threadId is required');
				return;
			}
			const agentId = this.threadToAgentId.get(threadId);
			if (agentId === undefined) {
				this.client.respondError(request.id, -32602, `Unknown threadId: ${threadId}`);
				return;
			}
			this.pendingRequestToAgent.set(request.id, agentId);
			this.options.onEvent({ type: 'agentToolPermission', id: agentId });
			this.options.onEvent({
				type: 'agentApprovalRequested',
				id: agentId,
				requestId: request.id,
				method,
				payload: params,
				availableDecisions: Array.isArray(params.availableDecisions)
					? (params.availableDecisions as unknown[])
					: undefined,
			});
			return;
		}

		this.client.respondError(request.id, -32601, `Unsupported server request: ${method}`);
	};

	private handleItemStarted(threadId: string, item: Record<string, unknown> & { type: string; id: string }): void {
		const agentId = this.threadToAgentId.get(threadId);
		if (agentId === undefined) return;

		switch (item.type) {
			case 'agentMessage':
				this.options.onEvent({ type: 'agentMessageStart', id: agentId, itemId: item.id });
				break;
			case 'commandExecution': {
				const command = typeof item.command === 'string' ? item.command : 'Running command';
				this.options.onEvent({
					type: 'agentToolStart',
					id: agentId,
					toolId: item.id,
					status: `Running: ${command}`,
				});
				break;
			}
			case 'fileChange':
				this.options.onEvent({
					type: 'agentToolStart',
					id: agentId,
					toolId: item.id,
					status: 'Applying file changes',
				});
				break;
			case 'collabAgentToolCall': {
				const tool = typeof item.tool === 'string' ? item.tool : 'collab';
				this.options.onEvent({
					type: 'agentToolStart',
					id: agentId,
					toolId: item.id,
					status: `Collab: ${tool}`,
				});
				break;
			}
		}
	}

	private handleItemCompleted(threadId: string, item: Record<string, unknown> & { type: string; id: string }): void {
		const agentId = this.threadToAgentId.get(threadId);
		if (agentId === undefined) return;

		switch (item.type) {
			case 'agentMessage':
				this.options.onEvent({ type: 'agentMessageDone', id: agentId, itemId: item.id });
				break;
			case 'commandExecution':
			case 'fileChange':
			case 'collabAgentToolCall':
				this.options.onEvent({ type: 'agentToolDone', id: agentId, toolId: item.id });
				break;
		}

		// Spawned sub-agent threads from collab tool calls.
		if (item.type === 'collabAgentToolCall') {
			const tool = typeof item.tool === 'string' ? item.tool : '';
			const status = typeof item.status === 'string' ? item.status : '';
			const receiverThreadIds = Array.isArray(item.receiverThreadIds)
				? item.receiverThreadIds.filter((id): id is string => typeof id === 'string')
				: [];

			if (tool === 'spawnAgent' && status === 'completed' && receiverThreadIds.length > 0) {
				for (const spawnedThreadId of receiverThreadIds) {
					if (this.threadToAgentId.has(spawnedThreadId)) continue;
					const spawnedAgentId = this.options.allocateAgentId();
					this.registerAgent(spawnedAgentId, spawnedThreadId);
					this.options.onEvent({ type: 'agentCreated', id: spawnedAgentId });
					this.options.onEvent({
						type: 'spawnedAgent',
						id: spawnedAgentId,
						parentAgentId: agentId,
						parentRuntimeRefId: item.id,
						threadId: spawnedThreadId,
					});
					void this.client.threadResume({ threadId: spawnedThreadId }).catch((error) => {
						this.options.outputChannel.appendLine(
							`[codex] failed to resume spawned thread ${spawnedThreadId}: ${String(error)}`,
						);
					});
				}
			}
		}
	}
}

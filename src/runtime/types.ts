export type RuntimeKind = 'claude' | 'codex';

export interface RuntimeAgentRef {
	agentId: number;
	runtime: RuntimeKind;
	folderName?: string;
	parentAgentId?: number;
	parentRuntimeRefId?: string;
	externalId: string;
}

export interface PersistedRuntimeAgentV2 {
	id: number;
	runtime: RuntimeKind;
	folderName?: string;
	parentAgentId?: number;
	parentRuntimeRefId?: string;
	claude?: {
		terminalName: string;
		jsonlFile: string;
		projectDir: string;
	};
	codex?: {
		threadId: string;
		status?: string;
	};
}

export type RuntimeEvent =
	| { type: 'agentCreated'; id: number; folderName?: string }
	| { type: 'agentClosed'; id: number }
	| { type: 'agentSelected'; id: number }
	| { type: 'agentStatus'; id: number; status: 'active' | 'waiting' }
	| { type: 'agentToolStart'; id: number; toolId: string; status: string }
	| { type: 'agentToolDone'; id: number; toolId: string }
	| { type: 'agentToolsClear'; id: number }
	| { type: 'agentToolPermission'; id: number }
	| { type: 'agentToolPermissionClear'; id: number }
	| { type: 'agentMessageStart'; id: number; itemId: string }
	| { type: 'agentMessageDelta'; id: number; itemId: string; delta: string }
	| { type: 'agentMessageDone'; id: number; itemId: string }
	| { type: 'agentCommandOutputDelta'; id: number; itemId: string; delta: string }
	| { type: 'agentFileChangeOutputDelta'; id: number; itemId: string; delta: string }
	| { type: 'agentDiffUpdated'; id: number; turnId: string; diff: string }
	| {
			type: 'agentApprovalRequested';
			id: number;
			requestId: string | number;
			method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
			payload: Record<string, unknown>;
			availableDecisions?: unknown[];
	  }
	| { type: 'agentApprovalResolved'; id: number; requestId: string | number }
	| {
			type: 'spawnedAgent';
			id: number;
			parentAgentId: number;
			parentRuntimeRefId: string;
			threadId: string;
	  };

export interface RuntimeProvider {
	readonly kind: RuntimeKind;
	initialize(): Promise<void>;
	dispose(): Promise<void>;
}

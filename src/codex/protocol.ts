export type JsonRpcId = string | number;

export interface JsonRpcRequest<TParams = unknown> {
	id: JsonRpcId;
	method: string;
	params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
	method: string;
	params?: TParams;
}

export interface JsonRpcSuccess<T = unknown> {
	id: JsonRpcId;
	result: T;
}

export interface JsonRpcFailure {
	id: JsonRpcId | null;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export type JsonRpcMessage =
	| JsonRpcRequest
	| JsonRpcNotification
	| JsonRpcSuccess
	| JsonRpcFailure;

export interface InitializeParams {
	clientInfo: {
		name: string;
		title?: string;
		version: string;
	};
	capabilities: {
		experimentalApi: boolean;
		optOutNotificationMethods?: string[];
	} | null;
}

export interface ThreadStartParams {
	cwd?: string | null;
	persistExtendedHistory?: boolean | null;
}

export interface ThreadResumeParams {
	threadId: string;
	cwd?: string | null;
}

export interface ThreadArchiveParams {
	threadId: string;
}

export interface TurnStartParams {
	threadId: string;
	input: Array<{
		type: 'text' | 'image' | 'localImage';
		text?: string;
		url?: string;
		path?: string;
	}>;
}

export interface TurnInterruptParams {
	threadId: string;
	turnId: string;
}

export interface TurnSteerParams {
	threadId: string;
	expectedTurnId: string;
	input: Array<{
		type: 'text';
		text: string;
	}>;
}

export interface ThreadStartResponse {
	thread: {
		id: string;
		status?: { type: string };
	};
}

export interface ThreadResumeResponse {
	thread: {
		id: string;
		status?: { type: string };
	};
}

export interface TurnStartResponse {
	turn: {
		id: string;
		status: string;
	};
}

export interface TurnNotification {
	threadId: string;
	turn: {
		id: string;
		status: string;
		error?: unknown;
	};
}

export interface ItemNotification {
	threadId: string;
	turnId: string;
	item: Record<string, unknown> & {
		type: string;
		id: string;
	};
}

export interface ItemDeltaNotification {
	threadId: string;
	turnId: string;
	itemId: string;
	delta: string;
}

export interface TurnDiffUpdatedNotification {
	threadId: string;
	turnId: string;
	diff: string;
}

export interface ServerRequestResolvedNotification {
	threadId: string;
	requestId: JsonRpcId;
}

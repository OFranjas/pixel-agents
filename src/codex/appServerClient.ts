import { EventEmitter } from 'events';
import type {
	InitializeParams,
	ItemDeltaNotification,
	ItemNotification,
	JsonRpcFailure,
	JsonRpcId,
	JsonRpcMessage,
	JsonRpcNotification,
	JsonRpcRequest,
	ServerRequestResolvedNotification,
	ThreadArchiveParams,
	ThreadResumeParams,
	ThreadResumeResponse,
	ThreadStartParams,
	ThreadStartResponse,
	TurnDiffUpdatedNotification,
	TurnInterruptParams,
	TurnNotification,
	TurnStartParams,
	TurnStartResponse,
	TurnSteerParams,
} from './protocol.js';
import { CodexJsonRpcTransport } from './jsonRpcTransport.js';

interface ClientEvents {
	notification: (notification: JsonRpcNotification) => void;
	serverRequest: (request: JsonRpcRequest) => void;
	error: (error: Error) => void;
	stderr: (line: string) => void;
	exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	method: string;
}

export class CodexAppServerClient {
	private readonly emitter = new EventEmitter();
	private readonly pending = new Map<JsonRpcId, PendingRequest>();
	private nextRequestId = 1;
	private initialized = false;
	private initializePromise: Promise<void> | null = null;
	private initializeParams: InitializeParams | null = null;

	constructor(private readonly transport: CodexJsonRpcTransport) {
		this.transport.on('message', this.handleIncomingMessage);
		this.transport.on('stderr', (line) => this.emitter.emit('stderr', line));
		this.transport.on('error', (error) => {
			this.emitter.emit('error', error);
		});
		this.transport.on('exit', (code, signal) => {
			this.initialized = false;
			this.initializePromise = null;
			for (const [, pending] of this.pending) {
				pending.reject(new Error('Codex app-server process exited'));
			}
			this.pending.clear();
			this.emitter.emit('exit', code, signal);
		});
	}

	on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): void {
		this.emitter.on(event, listener as (...args: unknown[]) => void);
	}

	off<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): void {
		this.emitter.off(event, listener as (...args: unknown[]) => void);
	}

	start(): void {
		this.transport.start();
	}

	stop(): void {
		this.transport.stop();
	}

	async ensureInitialized(params?: InitializeParams): Promise<void> {
		if (params) {
			this.initializeParams = params;
		}
		if (this.initialized) {
			return;
		}
		if (this.initializePromise) {
			return this.initializePromise;
		}
		if (!this.initializeParams) {
			throw new Error('Codex app-server client is missing initialize params');
		}

		this.initializePromise = (async () => {
			await this.request('initialize', this.initializeParams);
			this.notify('initialized');
			this.initialized = true;
		})();

		try {
			await this.initializePromise;
		} finally {
			this.initializePromise = null;
		}
	}

	threadStart(params: ThreadStartParams): Promise<ThreadStartResponse> {
		return this.request('thread/start', params);
	}

	threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
		return this.request('thread/resume', params);
	}

	threadArchive(params: ThreadArchiveParams): Promise<Record<string, never>> {
		return this.request('thread/archive', params);
	}

	turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
		return this.request('turn/start', params);
	}

	turnSteer(params: TurnSteerParams): Promise<{ turnId: string }> {
		return this.request('turn/steer', params);
	}

	turnInterrupt(params: TurnInterruptParams): Promise<Record<string, never>> {
		return this.request('turn/interrupt', params);
	}

	respond(requestId: JsonRpcId, result: unknown): void {
		this.transport.send({ id: requestId, result });
	}

	respondError(requestId: JsonRpcId, code: number, message: string): void {
		this.transport.send({
			id: requestId,
			error: {
				code,
				message,
			},
		});
	}

	private async request<T>(method: string, params?: unknown): Promise<T> {
		if (method !== 'initialize') {
			await this.ensureInitialized();
		}
		return this.sendRequest(method, params);
	}

	private sendRequest<T>(method: string, params?: unknown): Promise<T> {
		const id = this.nextRequestId++;
		const request: JsonRpcRequest = {
			id,
			method,
			params,
		};

		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value: unknown) => resolve(value as T),
				reject,
				method,
			});
			try {
				this.transport.send(request);
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private notify(method: string, params?: unknown): void {
		const notification: JsonRpcNotification = { method, params };
		this.transport.send(notification);
	}

	private readonly handleIncomingMessage = (message: JsonRpcMessage): void => {
		const obj = message as unknown as Record<string, unknown>;
		const method = typeof obj.method === 'string' ? obj.method : null;
		const hasId = obj.id !== undefined;

		if (method && hasId) {
			this.emitter.emit('serverRequest', message as JsonRpcRequest);
			return;
		}

		if (method && !hasId) {
			this.emitter.emit('notification', message as JsonRpcNotification);
			return;
		}

		if (hasId) {
			const id = obj.id as JsonRpcId;
			const pending = this.pending.get(id);
			if (!pending) {
				return;
			}
			this.pending.delete(id);

			if (obj.error) {
				const errorObj = obj as unknown as JsonRpcFailure;
				pending.reject(new Error(`JSON-RPC error (${pending.method}): ${errorObj.error.message}`));
				return;
			}

			pending.resolve(obj.result);
		}
	};
}

export function isTurnStarted(notification: JsonRpcNotification): notification is JsonRpcNotification<TurnNotification> {
	return notification.method === 'turn/started';
}

export function isTurnCompleted(notification: JsonRpcNotification): notification is JsonRpcNotification<TurnNotification> {
	return notification.method === 'turn/completed';
}

export function isItemStarted(notification: JsonRpcNotification): notification is JsonRpcNotification<ItemNotification> {
	return notification.method === 'item/started';
}

export function isItemCompleted(notification: JsonRpcNotification): notification is JsonRpcNotification<ItemNotification> {
	return notification.method === 'item/completed';
}

export function isAgentMessageDelta(notification: JsonRpcNotification): notification is JsonRpcNotification<ItemDeltaNotification> {
	return notification.method === 'item/agentMessage/delta';
}

export function isCommandOutputDelta(notification: JsonRpcNotification): notification is JsonRpcNotification<ItemDeltaNotification> {
	return notification.method === 'item/commandExecution/outputDelta';
}

export function isFileChangeOutputDelta(notification: JsonRpcNotification): notification is JsonRpcNotification<ItemDeltaNotification> {
	return notification.method === 'item/fileChange/outputDelta';
}

export function isDiffUpdated(notification: JsonRpcNotification): notification is JsonRpcNotification<TurnDiffUpdatedNotification> {
	return notification.method === 'turn/diff/updated';
}

export function isServerRequestResolved(notification: JsonRpcNotification): notification is JsonRpcNotification<ServerRequestResolvedNotification> {
	return notification.method === 'serverRequest/resolved';
}

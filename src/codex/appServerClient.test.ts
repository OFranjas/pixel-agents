import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import { CodexAppServerClient } from './appServerClient.js';
import type { CodexJsonRpcTransport } from './jsonRpcTransport.js';
import type { InitializeParams, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest } from './protocol.js';

type TransportEvent = 'message' | 'stderr' | 'error' | 'exit';

class MockTransport {
	private readonly emitter = new EventEmitter();
	readonly sent: JsonRpcMessage[] = [];

	on(event: TransportEvent, listener: (...args: unknown[]) => void): void {
		this.emitter.on(event, listener);
	}

	off(event: TransportEvent, listener: (...args: unknown[]) => void): void {
		this.emitter.off(event, listener);
	}

	start(): void {}

	stop(): void {}

	send(message: JsonRpcMessage): void {
		this.sent.push(message);
	}

	emitMessage(message: JsonRpcMessage): void {
		this.emitter.emit('message', message);
	}

	emitExit(code: number | null = null, signal: NodeJS.Signals | null = null): void {
		this.emitter.emit('exit', code, signal);
	}
}

function createClientWithMock(): { client: CodexAppServerClient; transport: MockTransport } {
	const transport = new MockTransport();
	const client = new CodexAppServerClient(transport as unknown as CodexJsonRpcTransport);
	return { client, transport };
}

async function primeInitialized(client: CodexAppServerClient, transport: MockTransport): Promise<void> {
	const params: InitializeParams = {
		clientInfo: {
			name: 'pixel-agents-tests',
			version: '1.0.0',
		},
		capabilities: {
			experimentalApi: false,
		},
	};
	const initializePromise = client.ensureInitialized(params);
	const initializeRequest = transport.sent[0] as JsonRpcRequest<InitializeParams>;
	transport.emitMessage({ id: initializeRequest.id, result: {} });
	await initializePromise;
}

describe('CodexAppServerClient', () => {
	test('correlates concurrent out-of-order responses to the right requests', async () => {
		const { client, transport } = createClientWithMock();
		await primeInitialized(client, transport);

		const startedPromise = client.threadStart({ cwd: '/tmp' });
		const resumedPromise = client.threadResume({ threadId: 'thread-existing' });
		await Promise.resolve();

		assert.equal(transport.sent.length, 4);
		const startRequest = transport.sent[2] as JsonRpcRequest;
		const resumeRequest = transport.sent[3] as JsonRpcRequest;
		assert.equal(startRequest.method, 'thread/start');
		assert.equal(resumeRequest.method, 'thread/resume');

		transport.emitMessage({ id: resumeRequest.id, result: { thread: { id: 'resumed-thread' } } });
		transport.emitMessage({ id: startRequest.id, result: { thread: { id: 'started-thread' } } });

		const [started, resumed] = await Promise.all([startedPromise, resumedPromise]);
		assert.equal(started.thread.id, 'started-thread');
		assert.equal(resumed.thread.id, 'resumed-thread');
	});

	test('ensureInitialized sends initialize request then initialized notification', async () => {
		const { client, transport } = createClientWithMock();
		const params: InitializeParams = {
			clientInfo: {
				name: 'pixel-agents-tests',
				version: '1.0.0',
			},
			capabilities: {
				experimentalApi: false,
			},
		};

		const initializePromise = client.ensureInitialized(params);

		assert.equal(transport.sent.length, 1);
		const initializeRequest = transport.sent[0] as JsonRpcRequest<InitializeParams>;
		assert.equal(initializeRequest.method, 'initialize');
		assert.deepEqual(initializeRequest.params, params);

		transport.emitMessage({ id: initializeRequest.id, result: {} });
		await initializePromise;

		assert.equal(transport.sent.length, 2);
		const initializedNotification = transport.sent[1] as JsonRpcNotification;
		assert.equal(initializedNotification.method, 'initialized');
		assert.equal(Object.prototype.hasOwnProperty.call(initializedNotification, 'id'), false);
	});

	test('routes notification and server request to distinct events', () => {
		const { client, transport } = createClientWithMock();
		const notifications: JsonRpcNotification[] = [];
		const serverRequests: JsonRpcRequest[] = [];

		client.on('notification', (notification) => {
			notifications.push(notification);
		});
		client.on('serverRequest', (request) => {
			serverRequests.push(request);
		});

		transport.emitMessage({ method: 'turn/started', params: { threadId: 't-1' } });
		transport.emitMessage({ id: 42, method: 'server/request', params: { value: 7 } });

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].method, 'turn/started');
		assert.equal(serverRequests.length, 1);
		assert.equal(serverRequests[0].id, 42);
		assert.equal(serverRequests[0].method, 'server/request');
	});

	test('rejects pending requests when transport exits', async () => {
		const { client, transport } = createClientWithMock();
		await primeInitialized(client, transport);

		const pending = client.turnStart({ threadId: 'thr_1', input: [{ type: 'text', text: 'hello' }] });
		await Promise.resolve();

		transport.emitExit(1, null);
		await assert.rejects(
			pending,
			/error \(turn\/start\)|process exited|exited/i,
		);
	});
});

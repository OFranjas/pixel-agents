import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import type { JsonRpcMessage } from './protocol.js';

export interface CodexJsonRpcTransportOptions {
	command: string;
	autoRestart: boolean;
}

interface TransportEvents {
	message: (message: JsonRpcMessage) => void;
	stderr: (line: string) => void;
	error: (error: Error) => void;
	exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface ParsedJsonLineChunk {
	lines: string[];
	remainder: string;
}

export function parseJsonLinesChunk(buffer: string, chunk: string): ParsedJsonLineChunk {
	const merged = buffer + chunk;
	const lines: string[] = [];
	let remainder = merged;
	let newlineIdx = remainder.indexOf('\n');
	while (newlineIdx >= 0) {
		const line = remainder.slice(0, newlineIdx).trim();
		remainder = remainder.slice(newlineIdx + 1);
		if (line) {
			lines.push(line);
		}
		newlineIdx = remainder.indexOf('\n');
	}
	return { lines, remainder };
}

/**
 * Starts `codex app-server` over stdio and exchanges newline-delimited JSON-RPC messages.
 */
export class CodexJsonRpcTransport {
	private process: ChildProcessWithoutNullStreams | null = null;
	private stdoutBuffer = '';
	private restarting = false;
	private stopped = false;
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly emitter = new EventEmitter();

	constructor(private readonly options: CodexJsonRpcTransportOptions) {}

	on<K extends keyof TransportEvents>(event: K, listener: TransportEvents[K]): void {
		this.emitter.on(event, listener as (...args: unknown[]) => void);
	}

	off<K extends keyof TransportEvents>(event: K, listener: TransportEvents[K]): void {
		this.emitter.off(event, listener as (...args: unknown[]) => void);
	}

	isRunning(): boolean {
		return this.process !== null;
	}

	start(): void {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.process) {
			return;
		}

		this.stopped = false;
		this.stdoutBuffer = '';
		this.process = spawn(this.options.command, {
			shell: true,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		const child = this.process;

		child.stdout.on('data', (chunk: Buffer | string) => {
			this.handleStdoutChunk(chunk.toString('utf-8'));
		});

		child.stderr.on('data', (chunk: Buffer | string) => {
			const lines = chunk.toString('utf-8').split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) {
					this.emitter.emit('stderr', trimmed);
				}
			}
		});

		child.on('error', (error) => {
			this.emitter.emit('error', error);
		});

		child.on('exit', (code, signal) => {
			if (this.process !== child) {
				return;
			}
			this.process = null;
			this.emitter.emit('exit', code, signal);
			if (this.options.autoRestart && !this.restarting && !this.stopped) {
				this.restarting = true;
				this.restartTimer = setTimeout(() => {
					this.restartTimer = null;
					this.restarting = false;
					if (this.stopped || this.process) {
						return;
					}
					this.start();
				}, 1000);
			}
		});
	}

	stop(): void {
		this.stopped = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		this.restarting = false;
		if (!this.process) {
			return;
		}

		this.process.kill();
		this.process = null;
		this.stdoutBuffer = '';
	}

	send(message: JsonRpcMessage): void {
		if (!this.process) {
			throw new Error('Codex app-server transport is not running');
		}
		const payload = JSON.stringify(message);
		this.process.stdin.write(payload + '\n');
	}

	private handleStdoutChunk(chunk: string): void {
		const parsedChunk = parseJsonLinesChunk(this.stdoutBuffer, chunk);
		this.stdoutBuffer = parsedChunk.remainder;
		for (const line of parsedChunk.lines) {
			try {
				const parsed = JSON.parse(line) as JsonRpcMessage;
				this.emitter.emit('message', parsed);
			} catch {
				this.emitter.emit('stderr', `[transport] failed to parse JSON line: ${line}`);
			}
		}
	}
}

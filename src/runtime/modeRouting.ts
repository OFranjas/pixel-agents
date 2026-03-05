import type { RuntimeKind } from './types.js';

export type RuntimeMode = 'claude' | 'codex' | 'mixed';
export type RuntimeOpenRequest = 'openClaude' | 'openCodex';

export function normalizeRuntimeMode(value: string | undefined): RuntimeMode {
	if (value === 'codex' || value === 'mixed') {
		return value;
	}
	return 'claude';
}

export function resolveRuntimeForOpenRequest(
	mode: RuntimeMode,
	request: RuntimeOpenRequest,
): RuntimeKind | null {
	if (request === 'openCodex') {
		return mode === 'mixed' ? 'codex' : null;
	}
	if (mode === 'codex') {
		return 'codex';
	}
	return 'claude';
}

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeRuntimeMode, resolveRuntimeForOpenRequest } from './modeRouting.js';

describe('normalizeRuntimeMode', () => {
	test('defaults unknown values to claude', () => {
		assert.equal(normalizeRuntimeMode(undefined), 'claude');
		assert.equal(normalizeRuntimeMode(''), 'claude');
		assert.equal(normalizeRuntimeMode('anything-else'), 'claude');
	});

	test('preserves codex and mixed values', () => {
		assert.equal(normalizeRuntimeMode('codex'), 'codex');
		assert.equal(normalizeRuntimeMode('mixed'), 'mixed');
	});
});

describe('resolveRuntimeForOpenRequest', () => {
	test('routes + Agent to Claude in claude mode', () => {
		assert.equal(resolveRuntimeForOpenRequest('claude', 'openClaude'), 'claude');
		assert.equal(resolveRuntimeForOpenRequest('claude', 'openCodex'), null);
	});

	test('routes + Agent to Codex in codex mode', () => {
		assert.equal(resolveRuntimeForOpenRequest('codex', 'openClaude'), 'codex');
		assert.equal(resolveRuntimeForOpenRequest('codex', 'openCodex'), null);
	});

	test('routes both entry points in mixed mode', () => {
		assert.equal(resolveRuntimeForOpenRequest('mixed', 'openClaude'), 'claude');
		assert.equal(resolveRuntimeForOpenRequest('mixed', 'openCodex'), 'codex');
	});
});

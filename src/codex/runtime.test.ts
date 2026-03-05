import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hasPendingApprovalForAgent } from './runtime.js';

describe('hasPendingApprovalForAgent', () => {
	test('returns true when at least one request is pending for the agent', () => {
		const pending = new Map<string | number, number>([
			['req-1', 7],
			['req-2', 11],
			['req-3', 7],
		]);
		assert.equal(hasPendingApprovalForAgent(pending, 7), true);
		assert.equal(hasPendingApprovalForAgent(pending, 11), true);
	});

	test('returns false when no request is pending for the agent', () => {
		const pending = new Map<string | number, number>([
			['req-1', 7],
			['req-2', 11],
		]);
		assert.equal(hasPendingApprovalForAgent(pending, 15), false);
	});
});

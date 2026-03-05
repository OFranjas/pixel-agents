import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseJsonLinesChunk } from './jsonRpcTransport.js';

describe('parseJsonLinesChunk', () => {
	test('handles JSON split across chunks', () => {
		const first = parseJsonLinesChunk('', '{"id":1,"method":"turn/start"');
		assert.deepEqual(first.lines, []);
		assert.equal(first.remainder, '{"id":1,"method":"turn/start"');

		const second = parseJsonLinesChunk(first.remainder, ',"params":{"threadId":"t1"}}\n');
		assert.deepEqual(second.lines, ['{"id":1,"method":"turn/start","params":{"threadId":"t1"}}']);
		assert.equal(second.remainder, '');
	});

	test('handles multiple JSON messages in one chunk', () => {
		const parsed = parseJsonLinesChunk('', '{"id":1,"method":"a"}\n{"id":2,"method":"b"}\n');
		assert.deepEqual(parsed.lines, ['{"id":1,"method":"a"}', '{"id":2,"method":"b"}']);
		assert.equal(parsed.remainder, '');
	});

	test('trims blank lines and surrounding whitespace', () => {
		const parsed = parseJsonLinesChunk('', '\n  {"id":1,"method":"a"}  \n \n\t\n {"id":2,"method":"b"} \n  \n');
		assert.deepEqual(parsed.lines, ['{"id":1,"method":"a"}', '{"id":2,"method":"b"}']);
		assert.equal(parsed.remainder, '');
	});
});

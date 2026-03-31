import * as assert from 'assert';
import { computeAdjustments } from '../../documentChangeTracker';

/** Helper to build a minimal change object matching the expected signature. */
function makeChange(startLine: number, endLine: number, text: string) {
    return { range: { start: { line: startLine }, end: { line: endLine } }, text };
}

suite('computeAdjustments', () => {

    test('single line insertion → delta = 1', () => {
        // One newline in text, range covers 0 lines → delta = 1
        const result = computeAdjustments([makeChange(5, 5, 'hello\n')]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].delta, 1);
        assert.strictEqual(result[0].changeStart, 6, 'VS Code line 5 → 1-indexed changeStart 6');
    });

    test('single line deletion → delta = -1', () => {
        // No newlines in text, range covers 1 line → delta = -1
        const result = computeAdjustments([makeChange(3, 4, '')]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].delta, -1);
        assert.strictEqual(result[0].changeStart, 4);
    });

    test('multi-line insertion → delta = 3', () => {
        // 3 newlines in text, range covers 0 lines → delta = 3
        const result = computeAdjustments([makeChange(10, 10, 'a\nb\nc\n')]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].delta, 3);
        assert.strictEqual(result[0].changeStart, 11);
    });

    test('replacement: 2 newlines in text, range covers 1 line → delta = 1', () => {
        const result = computeAdjustments([makeChange(7, 8, 'line1\nline2\nline3')]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].delta, 1);
        assert.strictEqual(result[0].changeStart, 8);
    });

    test('no-op change (0 newlines, 0-line range) is filtered out', () => {
        // delta = 0 → should be removed from the result
        const result = computeAdjustments([makeChange(2, 2, 'x')]);
        assert.strictEqual(result.length, 0);
    });

    test('multiple changes are sorted bottom-to-top by start line', () => {
        const changes = [
            makeChange(2, 2, 'a\n'),   // start line 2
            makeChange(10, 10, 'b\n'),  // start line 10
            makeChange(5, 5, 'c\n'),    // start line 5
        ];
        const result = computeAdjustments(changes);
        assert.strictEqual(result.length, 3);
        // Bottom-to-top: line 10 first, then 5, then 2
        assert.strictEqual(result[0].changeStart, 11); // from line 10
        assert.strictEqual(result[1].changeStart, 6);  // from line 5
        assert.strictEqual(result[2].changeStart, 3);  // from line 2
    });

    test('changes at same start line maintain stable sort order', () => {
        const changes = [
            makeChange(5, 5, 'first\n'),
            makeChange(5, 5, 'second\n'),
        ];
        const result = computeAdjustments(changes);
        assert.strictEqual(result.length, 2);
        // Both have changeStart = 6; order should be stable (same start line)
        assert.strictEqual(result[0].changeStart, 6);
        assert.strictEqual(result[1].changeStart, 6);
        assert.strictEqual(result[0].delta, 1);
        assert.strictEqual(result[1].delta, 1);
    });

    test('changeStart is 1-indexed (VS Code 0-indexed line + 1)', () => {
        // Line 0 in VS Code → changeStart = 1
        const result = computeAdjustments([makeChange(0, 0, '\n')]);
        assert.strictEqual(result[0].changeStart, 1);
    });

    test('empty changes array returns empty result', () => {
        const result = computeAdjustments([]);
        assert.deepStrictEqual(result, []);
    });

    test('mixed insertions and deletions in one batch', () => {
        const changes = [
            makeChange(1, 1, 'new\nlines\n'),  // +2 at line 1
            makeChange(8, 11, ''),               // -3 at line 8
        ];
        const result = computeAdjustments(changes);
        assert.strictEqual(result.length, 2);
        // Sorted bottom-to-top: line 8 first, then line 1
        assert.strictEqual(result[0].changeStart, 9);
        assert.strictEqual(result[0].delta, -3);
        assert.strictEqual(result[1].changeStart, 2);
        assert.strictEqual(result[1].delta, 2);
    });
});

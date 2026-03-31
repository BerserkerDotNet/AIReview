import * as assert from 'assert';
import { adjustThreadLineNumbers } from '../../threadAnchorService';
import { createThread } from '../helpers/fixtures';

suite('adjustThreadLineNumbers', () => {

    test('shifts threads below changeStart by positive delta', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 10 }),
            createThread({ filePath: 'src/app.ts', lineNumber: 20 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 3);
        assert.strictEqual(changed, true);
        assert.strictEqual(threads[0].lineNumber, 13);
        assert.strictEqual(threads[1].lineNumber, 23);
    });

    test('shifts threads below changeStart by negative delta', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 15 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, -3);
        assert.strictEqual(changed, true);
        assert.strictEqual(threads[0].lineNumber, 12);
    });

    test('clamps deleted range to changeStart (negative delta larger than distance)', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 7 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, -10);
        assert.strictEqual(changed, true);
        assert.strictEqual(threads[0].lineNumber, 5, 'should clamp to changeStart');
    });

    test('returns false when no threads match the file path', () => {
        const threads = [
            createThread({ filePath: 'src/other.ts', lineNumber: 10 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 3);
        assert.strictEqual(changed, false);
        assert.strictEqual(threads[0].lineNumber, 10, 'unrelated thread should be unchanged');
    });

    test('returns true when delta is 0 but matching thread exists above changeStart', () => {
        // The function marks changed=true whenever it enters the shift block,
        // even if the effective line number doesn't change.
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 10 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 0);
        assert.strictEqual(changed, true);
        assert.strictEqual(threads[0].lineNumber, 10, 'line number should remain unchanged');
    });

    test('does not shift threads above the changeStart', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 3 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 3);
        assert.strictEqual(changed, false);
        assert.strictEqual(threads[0].lineNumber, 3);
    });

    test('does not shift thread exactly at changeStart', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 5 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 3);
        assert.strictEqual(changed, false);
        assert.strictEqual(threads[0].lineNumber, 5);
    });

    test('shifts thread at changeStart + 1', () => {
        const threads = [
            createThread({ filePath: 'src/app.ts', lineNumber: 6 }),
        ];
        const changed = adjustThreadLineNumbers(threads, 'src/app.ts', 5, 3);
        assert.strictEqual(changed, true);
        assert.strictEqual(threads[0].lineNumber, 9);
    });

    test('handles empty thread array', () => {
        const changed = adjustThreadLineNumbers([], 'src/app.ts', 5, 3);
        assert.strictEqual(changed, false);
    });
});

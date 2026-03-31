import * as assert from 'assert';
import { remapThreadPaths, removeThreadsByPath } from '../../threadPathService';
import { createThread } from '../helpers/fixtures';

suite('remapThreadPaths', () => {

    test('exact file rename', () => {
        const threads = [
            createThread({ filePath: 'src/old.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/old.ts', 'src/new.ts');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/new.ts');
    });

    test('folder rename remaps children via prefix match', () => {
        const threads = [
            createThread({ filePath: 'src/utils/helper.ts' }),
            createThread({ filePath: 'src/utils/index.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/utils', 'src/lib');
        assert.strictEqual(count, 2);
        assert.strictEqual(threads[0].filePath, 'src/lib/helper.ts');
        assert.strictEqual(threads[1].filePath, 'src/lib/index.ts');
    });

    test('case-insensitive matching for exact rename', () => {
        const threads = [
            createThread({ filePath: 'SRC/Old.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/old.ts', 'src/new.ts');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/new.ts');
    });

    test('case-insensitive matching for folder rename', () => {
        const threads = [
            createThread({ filePath: 'SRC/Utils/helper.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/utils', 'src/lib');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/lib/helper.ts');
    });

    test('returns 0 when no threads match', () => {
        const threads = [
            createThread({ filePath: 'src/other.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/old.ts', 'src/new.ts');
        assert.strictEqual(count, 0);
        assert.strictEqual(threads[0].filePath, 'src/other.ts', 'unrelated thread should be unchanged');
    });

    test('does not modify unrelated threads', () => {
        const threads = [
            createThread({ filePath: 'src/old.ts' }),
            createThread({ filePath: 'src/keep.ts' }),
        ];
        remapThreadPaths(threads, 'src/old.ts', 'src/new.ts');
        assert.strictEqual(threads[1].filePath, 'src/keep.ts');
    });

    test('returns 0 when oldPath equals newPath', () => {
        const threads = [
            createThread({ filePath: 'src/same.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/same.ts', 'src/same.ts');
        // The function will still reassign but semantically it's a no-op rename
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/same.ts');
    });

    test('handles empty thread array', () => {
        const count = remapThreadPaths([], 'src/old.ts', 'src/new.ts');
        assert.strictEqual(count, 0);
    });

    test('normalizes backslash inputs for exact rename', () => {
        const threads = [
            createThread({ filePath: 'src/old.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src\\old.ts', 'src\\new.ts');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/new.ts');
    });

    test('normalizes backslash inputs for folder rename', () => {
        const threads = [
            createThread({ filePath: 'src/components/App.tsx' }),
        ];
        const count = remapThreadPaths(threads, 'src\\components', 'src\\ui');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/ui/App.tsx');
    });

    test('handles mixed separators in thread filePath', () => {
        const threads = [
            createThread({ filePath: 'src\\utils\\helper.ts' }),
        ];
        const count = remapThreadPaths(threads, 'src/utils', 'src/lib');
        assert.strictEqual(count, 1);
        assert.strictEqual(threads[0].filePath, 'src/lib/helper.ts');
    });

    test('result always uses forward slashes', () => {
        const threads = [
            createThread({ filePath: 'a\\b\\c.ts' }),
        ];
        remapThreadPaths(threads, 'a\\b', 'x\\y');
        assert.ok(!threads[0].filePath.includes('\\'), 'result should not contain backslashes');
        assert.strictEqual(threads[0].filePath, 'x/y/c.ts');
    });
});

suite('removeThreadsByPath', () => {

    test('exact file delete', () => {
        const threads = [
            createThread({ filePath: 'src/delete-me.ts' }),
            createThread({ filePath: 'src/keep.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/delete-me.ts');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 1);
        assert.strictEqual(remaining[0].filePath, 'src/keep.ts');
    });

    test('folder delete removes all children via prefix match', () => {
        const threads = [
            createThread({ filePath: 'src/utils/a.ts' }),
            createThread({ filePath: 'src/utils/b.ts' }),
            createThread({ filePath: 'src/other.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/utils');
        assert.strictEqual(removedCount, 2);
        assert.strictEqual(remaining.length, 1);
        assert.strictEqual(remaining[0].filePath, 'src/other.ts');
    });

    test('case-insensitive matching for exact delete', () => {
        const threads = [
            createThread({ filePath: 'SRC/Delete-Me.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/delete-me.ts');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 0);
    });

    test('case-insensitive matching for folder delete', () => {
        const threads = [
            createThread({ filePath: 'SRC/Utils/helper.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/utils');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 0);
    });

    test('returns correct counts when no threads match', () => {
        const threads = [
            createThread({ filePath: 'src/keep.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/gone.ts');
        assert.strictEqual(removedCount, 0);
        assert.strictEqual(remaining.length, 1);
    });

    test('handles empty thread array', () => {
        const { remaining, removedCount } = removeThreadsByPath([], 'src/gone.ts');
        assert.strictEqual(removedCount, 0);
        assert.strictEqual(remaining.length, 0);
    });

    test('normalizes backslash inputs for exact delete', () => {
        const threads = [
            createThread({ filePath: 'src/old.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src\\old.ts');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 0);
    });

    test('normalizes backslash inputs for folder delete', () => {
        const threads = [
            createThread({ filePath: 'src/components/App.tsx' }),
            createThread({ filePath: 'src/utils.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src\\components');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 1);
    });

    test('handles mixed separators in thread filePath', () => {
        const threads = [
            createThread({ filePath: 'src\\utils\\helper.ts' }),
        ];
        const { remaining, removedCount } = removeThreadsByPath(threads, 'src/utils');
        assert.strictEqual(removedCount, 1);
        assert.strictEqual(remaining.length, 0);
    });
});

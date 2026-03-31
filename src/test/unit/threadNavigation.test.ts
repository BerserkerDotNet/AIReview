import * as assert from 'assert';
import { findNextThread, findPreviousThread } from '../../threadNavigation';
import { createThread } from '../helpers/fixtures';

suite('threadNavigation', () => {
    suite('findNextThread', () => {
        test('returns next thread in same file below cursor', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
                createThread({ filePath: 'a.ts', lineNumber: 20 }),
            ];
            const result = findNextThread(threads, 'a.ts', 7);
            assert.strictEqual(result?.lineNumber, 10);
        });

        test('wraps within file when cursor is past last thread', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
            ];
            const result = findNextThread(threads, 'a.ts', 15);
            assert.strictEqual(result?.lineNumber, 5);
        });

        test('crosses to another file when no more in current', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'b.ts', lineNumber: 1 }),
            ];
            // cursor on same line as only thread in a.ts → wraps to b.ts
            const result = findNextThread(threads, 'a.ts', 5);
            assert.strictEqual(result?.filePath, 'b.ts');
            assert.strictEqual(result?.lineNumber, 1);
        });

        test('returns undefined when no threads exist', () => {
            const result = findNextThread([], 'a.ts', 1);
            assert.strictEqual(result, undefined);
        });

        test('handles single thread — wraps to self', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
            ];
            const result = findNextThread(threads, 'a.ts', 10);
            assert.strictEqual(result?.lineNumber, 5);
            assert.strictEqual(result?.filePath, 'a.ts');
        });

        test('returns next thread when currentFile is undefined', () => {
            const threads = [
                createThread({ filePath: 'b.ts', lineNumber: 3 }),
                createThread({ filePath: 'a.ts', lineNumber: 7 }),
            ];
            // no current file → picks first file alphabetically
            const result = findNextThread(threads, undefined, 0);
            assert.strictEqual(result?.filePath, 'a.ts');
            assert.strictEqual(result?.lineNumber, 7);
        });

        test('multiple threads on same line — returns first by array order', () => {
            const threads = [
                createThread({ id: 'first', filePath: 'a.ts', lineNumber: 10 }),
                createThread({ id: 'second', filePath: 'a.ts', lineNumber: 10 }),
            ];
            const result = findNextThread(threads, 'a.ts', 5);
            assert.strictEqual(result?.id, 'first');
        });

        test('file sorting is case-sensitive (uppercase before lowercase)', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 1 }),
                createThread({ filePath: 'A.ts', lineNumber: 1 }),
            ];
            // JS sort: 'A' < 'a', so A.ts comes first
            const result = findNextThread(threads, 'A.ts', 1);
            assert.strictEqual(result?.filePath, 'a.ts');
        });

        test('numeric file names sort alphabetically not numerically', () => {
            const threads = [
                createThread({ filePath: 'file1.ts', lineNumber: 1 }),
                createThread({ filePath: 'file10.ts', lineNumber: 1 }),
                createThread({ filePath: 'file2.ts', lineNumber: 1 }),
            ];
            // alphabetical: file1.ts < file10.ts < file2.ts
            const result = findNextThread(threads, 'file1.ts', 1);
            assert.strictEqual(result?.filePath, 'file10.ts');
        });

        test('thread at line 1 with cursor at line 1 — wraps cross-file', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 1 }),
                createThread({ filePath: 'b.ts', lineNumber: 5 }),
            ];
            const result = findNextThread(threads, 'a.ts', 1);
            assert.strictEqual(result?.filePath, 'b.ts');
            assert.strictEqual(result?.lineNumber, 5);
        });
    });

    suite('findPreviousThread', () => {
        test('returns previous thread in same file above cursor', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
                createThread({ filePath: 'a.ts', lineNumber: 20 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 15);
            assert.strictEqual(result?.lineNumber, 10);
        });

        test('wraps within file when cursor is before first thread', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
                createThread({ filePath: 'a.ts', lineNumber: 20 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 3);
            assert.strictEqual(result?.lineNumber, 20);
        });

        test('crosses files in reverse order', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'b.ts', lineNumber: 10 }),
            ];
            // cursor on same line as only thread in b.ts → wraps to a.ts
            const result = findPreviousThread(threads, 'b.ts', 10);
            assert.strictEqual(result?.filePath, 'a.ts');
            assert.strictEqual(result?.lineNumber, 5);
        });

        test('returns undefined when no threads exist', () => {
            const result = findPreviousThread([], 'a.ts', 1);
            assert.strictEqual(result, undefined);
        });

        test('handles single thread — wraps to self', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 5);
            assert.strictEqual(result?.lineNumber, 10);
            assert.strictEqual(result?.filePath, 'a.ts');
        });

        test('returns previous thread when currentFile is undefined', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 3 }),
                createThread({ filePath: 'b.ts', lineNumber: 7 }),
            ];
            // no current file → picks last file in reverse alphabetical order
            const result = findPreviousThread(threads, undefined, 0);
            assert.strictEqual(result?.filePath, 'b.ts');
            assert.strictEqual(result?.lineNumber, 7);
        });

        test('multiple threads on same line — returns first by reverse sort', () => {
            const threads = [
                createThread({ id: 'first', filePath: 'a.ts', lineNumber: 10 }),
                createThread({ id: 'second', filePath: 'a.ts', lineNumber: 10 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 15);
            assert.strictEqual(result?.id, 'first');
        });

        test('cursor at line 0 (before all threads) — wraps to last thread', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
                createThread({ filePath: 'a.ts', lineNumber: 20 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 0);
            assert.strictEqual(result?.lineNumber, 20);
        });

        test('all threads in single file, cursor after last — wraps to last thread', () => {
            const threads = [
                createThread({ filePath: 'a.ts', lineNumber: 5 }),
                createThread({ filePath: 'a.ts', lineNumber: 10 }),
                createThread({ filePath: 'a.ts', lineNumber: 20 }),
            ];
            const result = findPreviousThread(threads, 'a.ts', 25);
            assert.strictEqual(result?.lineNumber, 20);
        });
    });
});

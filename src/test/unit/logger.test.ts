import * as assert from 'assert';
import { logInfo, logWarn, logError, disposeLogger } from '../../logger';

/* eslint-disable @typescript-eslint/no-require-imports */
const mockVscode = require('vscode') as any;

suite('logger', () => {
    let lines: string[];
    let originalCreateOutputChannel: any;

    setup(() => {
        lines = [];
        originalCreateOutputChannel = mockVscode.window.createOutputChannel;
        mockVscode.window.createOutputChannel = (_name: string) => ({
            appendLine: (value: string) => { lines.push(value); },
            dispose: () => {},
        });
        // Reset the singleton so each test gets a fresh channel
        disposeLogger();
    });

    teardown(() => {
        disposeLogger();
        mockVscode.window.createOutputChannel = originalCreateOutputChannel;
    });

    test('logInfo writes [INFO] prefix to output channel', () => {
        logInfo('hello world');
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0], '[INFO] hello world');
    });

    test('logWarn writes [WARN] prefix', () => {
        logWarn('something wrong');
        assert.strictEqual(lines[0], '[WARN] something wrong');
    });

    test('logWarn appends error message when Error is provided', () => {
        logWarn('oops', new Error('bad'));
        assert.strictEqual(lines[0], '[WARN] oops: bad');
    });

    test('logWarn appends stringified value for non-Error', () => {
        logWarn('oops', 'string error');
        assert.strictEqual(lines[0], '[WARN] oops: string error');
    });

    test('logError writes [ERROR] prefix with stack trace for Error objects', () => {
        const err = new Error('failure');
        logError('crash', err);
        assert.ok(lines[0].startsWith('[ERROR] crash: '));
        assert.ok(lines[0].includes('Error: failure'), 'should contain stack trace');
    });

    test('logError handles non-Error values', () => {
        logError('crash', 42);
        assert.strictEqual(lines[0], '[ERROR] crash: 42');
    });

    test('logError without error argument omits suffix', () => {
        logError('something failed');
        assert.strictEqual(lines[0], '[ERROR] something failed');
    });

    test('disposeLogger resets singleton — next call creates new channel', () => {
        logInfo('first');
        assert.strictEqual(lines.length, 1);

        disposeLogger();

        // Replace mock with a new tracking array
        const newLines: string[] = [];
        mockVscode.window.createOutputChannel = (_name: string) => ({
            appendLine: (value: string) => { newLines.push(value); },
            dispose: () => {},
        });

        logInfo('second');
        assert.strictEqual(newLines.length, 1);
        assert.strictEqual(newLines[0], '[INFO] second');
        // Original lines array should not have the second message
        assert.strictEqual(lines.length, 1);
    });
});

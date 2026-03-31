import * as assert from 'assert';
import { withCommandErrorHandling, pickThread } from '../../commandUtils';
import { disposeLogger } from '../../logger';
import { ReviewStore } from '../../reviewStore';
import * as mockVscode from './mocks/vscode';

// Access the mock window so we can override its methods per test
const win = mockVscode.window;

suite('withCommandErrorHandling', () => {
    let origShowError: typeof win.showErrorMessage;

    setup(() => {
        origShowError = win.showErrorMessage;
    });

    teardown(() => {
        win.showErrorMessage = origShowError;
    });

    test('calls the wrapped function and forwards arguments', async () => {
        const received: any[] = [];
        const wrapped = withCommandErrorHandling('test', async (...args: any[]) => {
            received.push(...args);
        });
        await wrapped('a', 42);
        assert.deepStrictEqual(received, ['a', 42]);
    });

    test('catches errors and shows error message', async () => {
        let shownMessage: string | undefined;
        win.showErrorMessage = async (msg: string) => { shownMessage = msg; return undefined; };

        const wrapped = withCommandErrorHandling('doStuff', async () => {
            throw new Error('boom');
        });
        await wrapped();
        assert.ok(shownMessage);
        assert.ok(shownMessage!.includes('boom'), `Expected "boom" in "${shownMessage}"`);
    });

    test('logs error with command name prefix', async () => {
        const logged: string[] = [];
        const origCreateOutputChannel = win.createOutputChannel;
        disposeLogger(); // reset singleton so mock takes effect
        win.createOutputChannel = (_name: string) => ({
            appendLine: (value: string) => { logged.push(value); },
            dispose: () => {},
        });

        const wrapped = withCommandErrorHandling('myCmd', async () => {
            throw new Error('fail');
        });
        await wrapped();

        win.createOutputChannel = origCreateOutputChannel;
        assert.ok(logged.length > 0, 'Expected logger output');
        assert.ok(
            logged.some(l => l.includes('myCmd')),
            `Expected log to contain "myCmd", got: ${JSON.stringify(logged)}`,
        );
    });

    test('handles non-Error thrown values', async () => {
        let shownMessage: string | undefined;
        win.showErrorMessage = async (msg: string) => { shownMessage = msg; return undefined; };

        const wrapped = withCommandErrorHandling('oops', async () => {
            throw 'string-error'; // eslint-disable-line no-throw-literal
        });
        await wrapped();
        assert.ok(shownMessage);
        assert.ok(
            shownMessage!.includes('An error occurred'),
            `Expected generic message, got "${shownMessage}"`,
        );
    });
});

suite('pickThread', () => {
    let store: ReviewStore;
    let origShowQuickPick: typeof win.showQuickPick;
    let origShowInfo: typeof win.showInformationMessage;

    setup(() => {
        store = new ReviewStore();
        origShowQuickPick = win.showQuickPick;
        origShowInfo = win.showInformationMessage;
    });

    teardown(() => {
        store.dispose();
        win.showQuickPick = origShowQuickPick;
        win.showInformationMessage = origShowInfo;
    });

    test('returns undefined when no threads exist', async () => {
        let infoShown = false;
        win.showInformationMessage = async () => { infoShown = true; return undefined; };

        const result = await pickThread(store);
        assert.strictEqual(result, undefined);
        assert.ok(infoShown, 'Expected info message about no threads');
    });

    test('filters by status when provided', async () => {
        await store.addThread('a.ts', 1, 'open thread');
        const t2 = await store.addThread('b.ts', 2, 'will resolve');
        await store.setThreadStatus(t2.id, 'resolved');

        let quickPickItems: any[] = [];
        win.showQuickPick = async (items: any[]) => {
            quickPickItems = items;
            return items[0];
        };

        await pickThread(store, 'resolved');
        assert.strictEqual(quickPickItems.length, 1, 'Expected only resolved threads');
        assert.strictEqual(quickPickItems[0].id, t2.id);
    });

    test('returns selected thread id from quick pick', async () => {
        const t = await store.addThread('c.ts', 5, 'pick me');

        win.showQuickPick = async (items: any[]) => items[0];

        const result = await pickThread(store);
        assert.strictEqual(result, t.id);
    });

    test('returns undefined when user cancels quick pick', async () => {
        await store.addThread('d.ts', 1, 'exists');

        win.showQuickPick = async () => undefined;

        const result = await pickThread(store);
        assert.strictEqual(result, undefined);
    });
});

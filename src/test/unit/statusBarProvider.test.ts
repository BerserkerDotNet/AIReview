import * as assert from 'assert';
import { StatusBarProvider } from '../../statusBarProvider';
import { ReviewThread } from '../../models';
import { createThread } from '../helpers/fixtures';

/* eslint-disable @typescript-eslint/no-require-imports */
const mockVscode = require('vscode') as any;

suite('StatusBarProvider', () => {
    let mockItem: any;
    let originalCreateStatusBarItem: any;
    let changeListeners: Array<() => void>;
    let mockThreads: ReviewThread[];

    function createMockStore() {
        changeListeners = [];
        return {
            onDidChangeThreads: (cb: () => void) => {
                changeListeners.push(cb);
                return { dispose: () => {} };
            },
            getThreads: () => mockThreads,
        } as any;
    }

    setup(() => {
        mockThreads = [];
        mockItem = {
            text: '',
            tooltip: undefined as string | undefined,
            command: undefined as string | undefined,
            show: () => { mockItem._visible = true; },
            hide: () => { mockItem._visible = false; },
            dispose: () => {},
            _visible: false,
        };
        originalCreateStatusBarItem = mockVscode.window.createStatusBarItem;
        mockVscode.window.createStatusBarItem = () => mockItem;
    });

    teardown(() => {
        mockVscode.window.createStatusBarItem = originalCreateStatusBarItem;
    });

    test('shows correct count text for open threads', () => {
        mockThreads = [
            createThread({ status: 'open' }),
            createThread({ status: 'open' }),
            createThread({ status: 'open' }),
        ];
        const provider = new StatusBarProvider(createMockStore());
        assert.strictEqual(mockItem.text, '💬 3 open');
        assert.strictEqual(mockItem._visible, true);
        provider.dispose();
    });

    test('shows open + resolved counts', () => {
        mockThreads = [
            createThread({ status: 'open' }),
            createThread({ status: 'open' }),
            createThread({ status: 'resolved' }),
        ];
        const provider = new StatusBarProvider(createMockStore());
        assert.strictEqual(mockItem.text, '💬 2 open · ✅ 1');
        provider.dispose();
    });

    test('hides when no threads after reactive update', () => {
        mockThreads = [createThread({ status: 'open' })];
        const store = createMockStore();
        const provider = new StatusBarProvider(store);
        assert.strictEqual(mockItem._visible, true);

        // Remove all threads and fire the change event
        mockThreads = [];
        for (const cb of changeListeners) { cb(); }
        assert.strictEqual(mockItem._visible, false);
        provider.dispose();
    });

    test('updates reactively when store fires change event', () => {
        mockThreads = [createThread({ status: 'open' })];
        const store = createMockStore();
        const provider = new StatusBarProvider(store);
        assert.strictEqual(mockItem.text, '💬 1 open');

        // Add more threads and fire change
        mockThreads = [
            createThread({ status: 'open' }),
            createThread({ status: 'open' }),
            createThread({ status: 'resolved' }),
            createThread({ status: 'resolved' }),
        ];
        for (const cb of changeListeners) { cb(); }
        assert.strictEqual(mockItem.text, '💬 2 open · ✅ 2');
        provider.dispose();
    });

    test('sets command and tooltip on status bar item', () => {
        mockThreads = [createThread({ status: 'open' })];
        const provider = new StatusBarProvider(createMockStore());
        assert.strictEqual(mockItem.command, 'workbench.action.focusCommentsPanel');
        assert.strictEqual(mockItem.tooltip, 'Open Review Comments Panel');
        provider.dispose();
    });
});

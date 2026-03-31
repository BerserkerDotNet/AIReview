import * as assert from 'assert';
import { registerCommands } from '../../commands';
import { ReviewStore } from '../../reviewStore';
import * as mockVscode from './mocks/vscode';

const win = mockVscode.window;
const cmds = mockVscode.commands;

suite('registerCommands', () => {
    let store: ReviewStore;
    let registeredCommands: Map<string, Function>;

    // Originals to restore
    let origRegisterCommand: typeof cmds.registerCommand;
    let origActiveTextEditor: typeof win.activeTextEditor;
    let origShowInputBox: typeof win.showInputBox;
    let origShowWarning: typeof win.showWarningMessage;
    let origShowInfo: typeof win.showInformationMessage;
    let origShowQuickPick: typeof win.showQuickPick;

    setup(() => {
        store = new ReviewStore();
        registeredCommands = new Map<string, Function>();

        // Save originals
        origRegisterCommand = cmds.registerCommand;
        origActiveTextEditor = win.activeTextEditor;
        origShowInputBox = win.showInputBox;
        origShowWarning = win.showWarningMessage;
        origShowInfo = win.showInformationMessage;
        origShowQuickPick = win.showQuickPick;

        // Capture command callbacks
        cmds.registerCommand = (id: string, cb: Function) => {
            registeredCommands.set(id, cb);
            return { dispose: () => {} };
        };

        const context = { subscriptions: [] } as any;
        registerCommands(context, store);
    });

    teardown(() => {
        store.dispose();
        cmds.registerCommand = origRegisterCommand;
        win.activeTextEditor = origActiveTextEditor;
        win.showInputBox = origShowInputBox;
        win.showWarningMessage = origShowWarning;
        win.showInformationMessage = origShowInfo;
        win.showQuickPick = origShowQuickPick;
    });

    function getCommand(id: string): Function {
        const cmd = registeredCommands.get(id);
        assert.ok(cmd, `Command "${id}" should be registered`);
        return cmd;
    }

    test('registers the expected number of commands', () => {
        // 11 commands from registerCommands + 1 from registerSetupCopilotPluginCommand
        assert.strictEqual(registeredCommands.size, 12);
    });

    // --- resolveThreadAtLine ---

    suite('resolveThreadAtLine', () => {
        test('no active editor → shows warning', async () => {
            let warningMsg: string | undefined;
            win.activeTextEditor = undefined;
            win.showWarningMessage = async (msg: string) => { warningMsg = msg; return undefined; };

            await getCommand('ai-review.resolveThreadAtLine')();
            assert.ok(warningMsg?.includes('No active editor'));
        });

        test('no thread at line → shows info message', async () => {
            let infoMsg: string | undefined;
            win.activeTextEditor = {
                document: { uri: mockVscode.Uri.file('src/foo.ts') },
                selection: { active: { line: 5 } },
            } as any;
            win.showInformationMessage = async (msg: string) => { infoMsg = msg; return undefined; };

            await getCommand('ai-review.resolveThreadAtLine')();
            assert.ok(infoMsg?.includes('No open review thread'));
        });

        test('thread found → resolves it', async () => {
            const thread = await store.addThread('src/foo.ts', 10, 'fix this');
            assert.strictEqual(thread.status, 'open');

            win.activeTextEditor = {
                document: { uri: mockVscode.Uri.file('src/foo.ts') },
                selection: { active: { line: 9 } }, // 0-indexed → 1-indexed = 10
            } as any;

            await getCommand('ai-review.resolveThreadAtLine')();
            const updated = store.getThread(thread.id);
            assert.strictEqual(updated?.status, 'resolved');
        });
    });

    // --- addComment ---

    suite('addComment', () => {
        test('no args and no active editor → shows warning', async () => {
            let warningMsg: string | undefined;
            win.activeTextEditor = undefined;
            win.showWarningMessage = async (msg: string) => { warningMsg = msg; return undefined; };

            await getCommand('ai-review.addComment')();
            assert.ok(warningMsg?.includes('No active editor'));
        });

        test('with active editor and input → adds thread', async () => {
            win.activeTextEditor = {
                document: { uri: mockVscode.Uri.file('src/bar.ts') },
                selection: { active: { line: 4 } },
            } as any;
            win.showInputBox = async () => 'REVIEW: new concern';

            await getCommand('ai-review.addComment')();
            const threads = store.getThreads();
            assert.strictEqual(threads.length, 1);
            assert.strictEqual(threads[0].lineNumber, 5); // 0-indexed + 1
            assert.strictEqual(threads[0].comments[0].body, 'REVIEW: new concern');
        });

        test('with explicit uriStr and line args → adds thread at given location', async () => {
            win.showInputBox = async () => 'explicit comment';

            await getCommand('ai-review.addComment')('file:///src/explicit.ts', 42);
            const threads = store.getThreads();
            assert.strictEqual(threads.length, 1);
            assert.strictEqual(threads[0].lineNumber, 42);
        });

        test('user cancels input box → does not add thread', async () => {
            win.activeTextEditor = {
                document: { uri: mockVscode.Uri.file('src/bar.ts') },
                selection: { active: { line: 0 } },
            } as any;
            win.showInputBox = async () => undefined;

            await getCommand('ai-review.addComment')();
            assert.strictEqual(store.getThreads().length, 0);
        });
    });

    // --- editComment ---

    suite('editComment', () => {
        test('no editable user comments → shows info message', async () => {
            // addThread creates a 'user' comment. Stub store.getThread to return
            // the thread with all comments remapped to 'llm' author so the
            // `userComments.length === 0` branch is exercised.
            const thread = await store.addThread('src/x.ts', 1, 'placeholder');
            const origGetThread = store.getThread.bind(store);
            store.getThread = (id: string) => {
                const t = origGetThread(id);
                if (t) {
                    return { ...t, comments: t.comments.map(c => ({ ...c, author: 'llm' as const })) };
                }
                return t;
            };

            let infoMsg: string | undefined;
            win.showInformationMessage = async (msg: string) => { infoMsg = msg; return undefined; };

            await getCommand('ai-review.editComment')(thread.id);
            assert.ok(infoMsg?.includes('No editable comments'));

            store.getThread = origGetThread;
        });
    });

    // --- clearResolvedThreads ---

    suite('clearResolvedThreads', () => {
        test('0 resolved threads → shows info message', async () => {
            await store.addThread('src/a.ts', 1, 'open thread');
            let infoMsg: string | undefined;
            win.showInformationMessage = async (msg: string) => { infoMsg = msg; return undefined; };

            await getCommand('ai-review.clearResolvedThreads')();
            assert.ok(infoMsg?.includes('No resolved threads'));
        });

        test('confirm=Delete → clears resolved threads', async () => {
            const t1 = await store.addThread('src/a.ts', 1, 'will resolve');
            const t2 = await store.addThread('src/b.ts', 2, 'will resolve too');
            await store.addThread('src/c.ts', 3, 'stays open');
            await store.setThreadStatus(t1.id, 'resolved');
            await store.setThreadStatus(t2.id, 'resolved');

            win.showWarningMessage = async () => 'Delete';
            let clearedMsg: string | undefined;
            win.showInformationMessage = async (msg: string) => { clearedMsg = msg; return undefined; };

            await getCommand('ai-review.clearResolvedThreads')();
            assert.strictEqual(store.getThreads().length, 1, 'Only the open thread should remain');
            assert.ok(clearedMsg?.includes('2'), 'Should report 2 cleared');
        });

        test('confirm cancelled → does not clear', async () => {
            const t = await store.addThread('src/a.ts', 1, 'resolved');
            await store.setThreadStatus(t.id, 'resolved');

            win.showWarningMessage = async () => undefined; // user cancelled

            await getCommand('ai-review.clearResolvedThreads')();
            assert.strictEqual(store.getThreads().length, 1, 'Thread should still exist');
        });
    });

    // --- deleteThread ---

    suite('deleteThread', () => {
        test('confirm cancel → does not delete', async () => {
            const t = await store.addThread('src/a.ts', 1, 'keep me');
            win.showWarningMessage = async () => undefined; // user cancelled

            await getCommand('ai-review.deleteThread')(t.id);
            assert.ok(store.getThread(t.id), 'Thread should still exist');
        });

        test('confirm=Delete → deletes thread', async () => {
            const t = await store.addThread('src/a.ts', 1, 'delete me');
            win.showWarningMessage = async () => 'Delete';

            await getCommand('ai-review.deleteThread')(t.id);
            assert.strictEqual(store.getThread(t.id), undefined, 'Thread should be deleted');
        });
    });

    // --- reopenThread ---

    suite('reopenThread', () => {
        test('delegates to setThreadStatus with open', async () => {
            const t = await store.addThread('src/a.ts', 1, 'resolved thread');
            await store.setThreadStatus(t.id, 'resolved');
            assert.strictEqual(store.getThread(t.id)?.status, 'resolved');

            await getCommand('ai-review.reopenThread')(t.id);
            assert.strictEqual(store.getThread(t.id)?.status, 'open');
        });
    });

    // --- resolveThread ---

    suite('resolveThread', () => {
        test('resolves an open thread by id', async () => {
            const t = await store.addThread('src/a.ts', 1, 'resolve me');
            await getCommand('ai-review.resolveThread')(t.id);
            assert.strictEqual(store.getThread(t.id)?.status, 'resolved');
        });
    });

    // --- unresolveThread ---

    suite('unresolveThread', () => {
        test('unresolves a resolved thread by id', async () => {
            const t = await store.addThread('src/a.ts', 1, 'unresolve me');
            await store.setThreadStatus(t.id, 'resolved');
            await getCommand('ai-review.unresolveThread')(t.id);
            assert.strictEqual(store.getThread(t.id)?.status, 'open');
        });
    });

    // --- replyToThread ---

    suite('replyToThread', () => {
        test('adds a reply to existing thread', async () => {
            const t = await store.addThread('src/a.ts', 1, 'original');
            win.showInputBox = async () => 'my reply';

            await getCommand('ai-review.replyToThread')(t.id);
            const updated = store.getThread(t.id);
            assert.strictEqual(updated?.comments.length, 2);
            assert.strictEqual(updated?.comments[1].body, 'my reply');
        });

        test('user cancels input → does not add reply', async () => {
            const t = await store.addThread('src/a.ts', 1, 'original');
            win.showInputBox = async () => undefined;

            await getCommand('ai-review.replyToThread')(t.id);
            assert.strictEqual(store.getThread(t.id)?.comments.length, 1);
        });
    });

    // --- nextThread / previousThread ---

    suite('nextThread', () => {
        test('no open threads → shows info message', async () => {
            let infoMsg: string | undefined;
            win.activeTextEditor = undefined;
            win.showInformationMessage = async (msg: string) => { infoMsg = msg; return undefined; };

            await getCommand('ai-review.nextThread')();
            assert.ok(infoMsg?.includes('No open review threads'));
        });
    });

    suite('previousThread', () => {
        test('no open threads → shows info message', async () => {
            let infoMsg: string | undefined;
            win.activeTextEditor = undefined;
            win.showInformationMessage = async (msg: string) => { infoMsg = msg; return undefined; };

            await getCommand('ai-review.previousThread')();
            assert.ok(infoMsg?.includes('No open review threads'));
        });
    });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ReviewStore } from '../../reviewStore';
import { ReviewCommentController, ReviewNoteComment } from '../../commentController';
import type { ReviewThread } from '../../models';

// Grab mock module so we can manipulate workspace.workspaceFolders
const mockVscode: typeof vscode & { workspace: { workspaceFolders: any } } = vscode as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
    return {
        id: overrides.id ?? 'thread-1',
        filePath: overrides.filePath ?? 'src/app.ts',
        lineNumber: overrides.lineNumber ?? 10,
        status: overrides.status ?? 'open',
        createdAt: overrides.createdAt ?? '2024-01-01T00:00:00Z',
        comments: overrides.comments ?? [
            {
                id: 'c-1',
                author: 'user',
                body: 'Fix this',
                timestamp: '2024-01-01T00:00:00Z',
            },
        ],
    };
}

suite('ReviewCommentController — Unit Tests', () => {
    let store: ReviewStore;
    let controller: ReviewCommentController;

    setup(() => {
        mockVscode.workspace.workspaceFolders = [
            { uri: mockVscode.Uri.file('/test'), name: 'test', index: 0 },
        ];
        store = new ReviewStore();
        controller = new ReviewCommentController(store);
    });

    teardown(() => {
        controller.dispose();
        store.dispose();
        mockVscode.workspace.workspaceFolders = undefined;
    });

    // -----------------------------------------------------------------------
    // syncFromStore dispatch
    // -----------------------------------------------------------------------
    suite('syncFromStore dispatch', () => {
        test('no event → full sync (rebuilds all threads)', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'a' }), makeReviewThread({ id: 'b' })],
            });
            // loadData fires 'reload' which auto-syncs, but let's clear and re-test
            // with explicit no-arg call
            const map = controller.getThreadMap();
            // After loadData + auto-sync, both threads should exist
            assert.strictEqual(map.size, 2);

            // Now remove one thread from store and call syncFromStore()
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'a' })],
            });
            // auto-sync via reload should leave only 'a'
            assert.strictEqual(map.size, 1);
            assert.ok(map.has('a'));
        });

        test('{type:"reload"} → full sync', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'x' })],
            });
            assert.strictEqual(controller.getThreadMap().size, 1);

            await controller.syncFromStore({ type: 'reload' });
            assert.strictEqual(controller.getThreadMap().size, 1);
            assert.ok(controller.getThreadMap().has('x'));
        });

        test('{type:"delete", threadId} → disposes and removes that thread', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'd1' }), makeReviewThread({ id: 'd2' })],
            });
            const map = controller.getThreadMap();
            assert.strictEqual(map.size, 2);

            let disposed = false;
            const thread = map.get('d1')!;
            const origDispose = thread.dispose.bind(thread);
            thread.dispose = () => { disposed = true; origDispose(); };

            await controller.syncFromStore({ type: 'delete', threadId: 'd1' });
            assert.strictEqual(disposed, true, 'Thread should be disposed');
            assert.strictEqual(map.has('d1'), false, 'Thread should be removed from map');
            assert.strictEqual(map.size, 1);
        });

        test('{type:"add", threadId} → creates new VS Code thread in map', async () => {
            store.loadData({ version: 1, threads: [] });
            assert.strictEqual(controller.getThreadMap().size, 0);

            // Manually add a thread to the store data (bypassing events)
            const newThread = makeReviewThread({ id: 'new-1' });
            store.loadData({ version: 1, threads: [newThread] });
            // loadData fires reload, but let's reset and test add specifically
            controller.getThreadMap().clear();

            await controller.syncFromStore({ type: 'add', threadId: 'new-1' });
            assert.strictEqual(controller.getThreadMap().size, 1);
            assert.ok(controller.getThreadMap().has('new-1'));
        });

        test('{type:"update", threadId} → updates existing thread', async () => {
            const thread = makeReviewThread({ id: 'upd-1', status: 'open' });
            store.loadData({ version: 1, threads: [thread] });

            const map = controller.getThreadMap();
            assert.strictEqual(map.size, 1);
            const vscThread = map.get('upd-1')!;
            assert.strictEqual(vscThread.contextValue, 'open');

            // Change status in store
            thread.status = 'resolved';
            store.loadData({ version: 1, threads: [thread] });
            // Clear map to test targeted update
            // Actually, loadData fires reload. Let's just directly test syncFromStore with update
            // Re-setup: load open, then mutate store data and call update
            const t2 = makeReviewThread({ id: 'upd-2', status: 'open' });
            store.loadData({ version: 1, threads: [t2] });
            const vsc2 = controller.getThreadMap().get('upd-2')!;
            assert.strictEqual(vsc2.contextValue, 'open');

            // Mutate the underlying data
            t2.status = 'resolved';
            await controller.syncFromStore({ type: 'update', threadId: 'upd-2' });
            assert.strictEqual(vsc2.contextValue, 'resolved');
            assert.strictEqual(vsc2.label, '✅ Resolved');
        });

        test('{type:"update", filePath} → rebuilds threads for that file only', async () => {
            const t1 = makeReviewThread({ id: 'f1', filePath: 'src/a.ts' });
            const t2 = makeReviewThread({ id: 'f2', filePath: 'src/b.ts' });
            store.loadData({ version: 1, threads: [t1, t2] });

            const map = controller.getThreadMap();
            assert.strictEqual(map.size, 2);

            // Mutate t1
            t1.status = 'resolved';
            await controller.syncFromStore({ type: 'update', filePath: 'src/a.ts' });

            const vscT1 = map.get('f1')!;
            assert.strictEqual(vscT1.contextValue, 'resolved');
            // t2 should be untouched
            const vscT2 = map.get('f2')!;
            assert.strictEqual(vscT2.contextValue, 'open');
        });

        test('unknown event with no threadId/filePath → falls back to fullSync', async () => {
            const t1 = makeReviewThread({ id: 'fb1' });
            store.loadData({ version: 1, threads: [t1] });
            assert.strictEqual(controller.getThreadMap().size, 1);

            // Add another thread to store, then trigger an update event with no threadId/filePath
            const t2 = makeReviewThread({ id: 'fb2' });
            store.loadData({ version: 1, threads: [t1, t2] });
            // Clear map to test fallback
            controller.getThreadMap().clear();

            await controller.syncFromStore({ type: 'update' });
            // Should have done a fullSync and populated both
            assert.strictEqual(controller.getThreadMap().size, 2);
        });
    });

    // -----------------------------------------------------------------------
    // getThreadId
    // -----------------------------------------------------------------------
    suite('getThreadId', () => {
        test('returns correct ID for known thread', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'known-1' })],
            });
            const vscThread = controller.getThreadMap().get('known-1')!;
            assert.strictEqual(controller.getThreadId(vscThread), 'known-1');
        });

        test('returns undefined for unknown thread', () => {
            const unknownThread = {
                uri: vscode.Uri.file('/unknown'),
                range: new vscode.Range(0, 0, 0, 0),
                comments: [],
                dispose: () => {},
            } as unknown as vscode.CommentThread;

            assert.strictEqual(controller.getThreadId(unknownThread), undefined);
        });
    });

    // -----------------------------------------------------------------------
    // toVscodeComments
    // -----------------------------------------------------------------------
    suite('toVscodeComments (via syncFromStore)', () => {
        test("maps 'user' author to 'You', 'llm' to 'AI'", async () => {
            const thread = makeReviewThread({
                id: 'author-test',
                comments: [
                    { id: 'c1', author: 'user', body: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
                    { id: 'c2', author: 'llm', body: 'World', timestamp: '2024-01-01T00:00:00Z' },
                ],
            });
            store.loadData({ version: 1, threads: [thread] });

            const vscThread = controller.getThreadMap().get('author-test')!;
            const comments = vscThread.comments as ReviewNoteComment[];
            assert.strictEqual(comments.length, 2);
            assert.strictEqual(comments[0].author.name, 'You');
            assert.strictEqual(comments[1].author.name, 'AI');
        });

        test("includes '(edited)' suffix when editedAt is set", async () => {
            const thread = makeReviewThread({
                id: 'edited-test',
                comments: [
                    {
                        id: 'c1',
                        author: 'user',
                        body: 'Original',
                        timestamp: '2024-01-01T00:00:00Z',
                        editedAt: '2024-01-02T00:00:00Z',
                    },
                    {
                        id: 'c2',
                        author: 'user',
                        body: 'Not edited',
                        timestamp: '2024-01-01T00:00:00Z',
                    },
                ],
            });
            store.loadData({ version: 1, threads: [thread] });

            const vscThread = controller.getThreadMap().get('edited-test')!;
            const comments = vscThread.comments as ReviewNoteComment[];
            const body0 = comments[0].body as vscode.MarkdownString;
            const body1 = comments[1].body as vscode.MarkdownString;
            assert.ok(body0.value.includes('*(edited)*'), 'Edited comment should include (edited)');
            assert.ok(!body1.value.includes('*(edited)*'), 'Unedited comment should not include (edited)');
        });

        test("sets contextValue='editable' only for user comments", async () => {
            const thread = makeReviewThread({
                id: 'ctx-test',
                comments: [
                    { id: 'c1', author: 'user', body: 'User', timestamp: '2024-01-01T00:00:00Z' },
                    { id: 'c2', author: 'llm', body: 'AI', timestamp: '2024-01-01T00:00:00Z' },
                ],
            });
            store.loadData({ version: 1, threads: [thread] });

            const vscThread = controller.getThreadMap().get('ctx-test')!;
            const comments = vscThread.comments as ReviewNoteComment[];
            assert.strictEqual(comments[0].contextValue, 'editable');
            assert.strictEqual(comments[1].contextValue, undefined);
        });

        test('sets CommentMode.Preview', async () => {
            const thread = makeReviewThread({ id: 'mode-test' });
            store.loadData({ version: 1, threads: [thread] });

            const vscThread = controller.getThreadMap().get('mode-test')!;
            const comments = vscThread.comments as ReviewNoteComment[];
            assert.strictEqual(comments[0].mode, vscode.CommentMode.Preview);
        });
    });

    // -----------------------------------------------------------------------
    // fullSync
    // -----------------------------------------------------------------------
    suite('fullSync (via syncFromStore with no event)', () => {
        test('removes threads no longer in store', async () => {
            store.loadData({
                version: 1,
                threads: [
                    makeReviewThread({ id: 'stay' }),
                    makeReviewThread({ id: 'remove' }),
                ],
            });
            const map = controller.getThreadMap();
            assert.strictEqual(map.size, 2);

            // Reload with only one thread
            store.loadData({ version: 1, threads: [makeReviewThread({ id: 'stay' })] });
            assert.strictEqual(map.size, 1);
            assert.ok(map.has('stay'));
            assert.ok(!map.has('remove'));
        });

        test('adds new threads from store', async () => {
            store.loadData({ version: 1, threads: [] });
            assert.strictEqual(controller.getThreadMap().size, 0);

            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'new-a' }), makeReviewThread({ id: 'new-b' })],
            });
            assert.strictEqual(controller.getThreadMap().size, 2);
        });

        test('updates existing threads', async () => {
            const t = makeReviewThread({ id: 'upd', status: 'open' });
            store.loadData({ version: 1, threads: [t] });

            const vscThread = controller.getThreadMap().get('upd')!;
            assert.strictEqual(vscThread.label, '💬 Open');

            t.status = 'resolved';
            await controller.syncFromStore(); // fullSync
            assert.strictEqual(vscThread.label, '✅ Resolved');
            assert.strictEqual(vscThread.state, vscode.CommentThreadState.Resolved);
        });
    });

    // -----------------------------------------------------------------------
    // createVscodeThread edge cases
    // -----------------------------------------------------------------------
    suite('createVscodeThread', () => {
        test('returns undefined when workspaceFolders is empty', async () => {
            mockVscode.workspace.workspaceFolders = undefined;
            store.loadData({ version: 1, threads: [makeReviewThread({ id: 'no-ws' })] });
            // The thread should not be created since workspaceFolders is undefined
            assert.strictEqual(controller.getThreadMap().has('no-ws'), false);
        });

        test('applies correct thread state for open thread', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'open-t', status: 'open' })],
            });
            const vsc = controller.getThreadMap().get('open-t')!;
            assert.strictEqual(vsc.label, '💬 Open');
            assert.strictEqual(vsc.state, vscode.CommentThreadState.Unresolved);
            assert.strictEqual(vsc.canReply, true);
            assert.strictEqual(vsc.contextValue, 'open');
        });

        test('applies correct thread state for resolved thread', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'res-t', status: 'resolved' })],
            });
            const vsc = controller.getThreadMap().get('res-t')!;
            assert.strictEqual(vsc.label, '✅ Resolved');
            assert.strictEqual(vsc.state, vscode.CommentThreadState.Resolved);
            assert.strictEqual(vsc.canReply, false);
            assert.strictEqual(vsc.contextValue, 'resolved');
        });
    });

    // -----------------------------------------------------------------------
    // syncDeletedThread
    // -----------------------------------------------------------------------
    suite('syncDeletedThread', () => {
        test('no-op when threadId is undefined', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'safe' })],
            });
            assert.strictEqual(controller.getThreadMap().size, 1);
            await controller.syncFromStore({ type: 'delete', threadId: undefined });
            assert.strictEqual(controller.getThreadMap().size, 1);
        });

        test('no-op when threadId is not in map', async () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'present' })],
            });
            assert.strictEqual(controller.getThreadMap().size, 1);
            await controller.syncFromStore({ type: 'delete', threadId: 'nonexistent' });
            assert.strictEqual(controller.getThreadMap().size, 1);
        });
    });

    // -----------------------------------------------------------------------
    // dispose
    // -----------------------------------------------------------------------
    suite('dispose', () => {
        test('clears threadMap on dispose', () => {
            store.loadData({
                version: 1,
                threads: [makeReviewThread({ id: 'disp-1' })],
            });
            assert.strictEqual(controller.getThreadMap().size, 1);
            controller.dispose();
            assert.strictEqual(controller.getThreadMap().size, 0);
        });
    });
});

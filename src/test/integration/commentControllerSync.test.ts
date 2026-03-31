import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import type { ThreadChangeEvent } from '../../changeEvent';

// NOTE: We cannot instantiate ReviewCommentController because the extension
// already registers 'ai-review.*' commands during activation and duplicate
// registration throws. Instead we verify:
//   1. onDidChangeThreads fires the correct scoped event (add/update/delete)
//   2. Store state is consistent after each operation
//   3. A lightweight test CommentController can reproduce the sync behaviour

suite('Scoped Sync Events – Store → Controller Integration', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let events: ThreadChangeEvent[];

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-sync-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);

        // Collect every event after the initial 'reload' from loadData
        events = [];
        store.onDidChangeThreads((e) => events.push(e));
    });

    teardown(() => {
        persistence.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- helpers ---------------------------------------------------------

    /** Create a throwaway VS Code CommentController + thread for state assertions. */
    function createTestThread(
        label: string,
        filePath: string,
    ): { controller: vscode.CommentController; thread: vscode.CommentThread } {
        const controller = vscode.comments.createCommentController(
            `sync-test-${label}-${Date.now()}`,
            'Sync Test',
        );
        const uri = vscode.Uri.file(path.join(tmpDir, filePath));
        fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        fs.writeFileSync(uri.fsPath, 'line 1\n');
        const thread = controller.createCommentThread(
            uri,
            new vscode.Range(0, 0, 0, 0),
            [],
        );
        return { controller, thread };
    }

    function applyThreadState(
        vscThread: vscode.CommentThread,
        status: 'open' | 'resolved',
    ): void {
        vscThread.label = status === 'resolved' ? '✅ Resolved' : '💬 Open';
        vscThread.state = status === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        vscThread.canReply = status === 'open';
        vscThread.contextValue = status;
        // Reassign comments to trigger VS Code re-render
        vscThread.comments = [...vscThread.comments];
    }

    // --- test cases ------------------------------------------------------

    test('add event fires with correct type, threadId and filePath', async () => {
        const thread = await store.addThread('src/test.ts', 5, 'Review comment');

        assert.strictEqual(events.length, 1, 'exactly one event after add');
        assert.strictEqual(events[0].type, 'add');
        assert.strictEqual(events[0].threadId, thread.id);
        assert.strictEqual(events[0].filePath, 'src/test.ts');
        assert.strictEqual(store.getThreads().length, 1, 'store has exactly 1 thread');
    });

    test('update event fires on resolve and controller thread state changes', async () => {
        const thread = await store.addThread('src/test.ts', 5, 'Review comment');
        events.length = 0;

        await store.setThreadStatus(thread.id, 'resolved');

        // Verify the scoped event
        assert.strictEqual(events.length, 1, 'exactly one event after resolve');
        assert.strictEqual(events[0].type, 'update');
        assert.strictEqual(events[0].threadId, thread.id);
        assert.strictEqual(events[0].filePath, 'src/test.ts');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');

        // Verify a test controller thread mirrors the resolved state
        const { controller, thread: vscThread } = createTestThread('resolve', 'src/test.ts');
        try {
            applyThreadState(vscThread, store.getThread(thread.id)!.status);
            assert.strictEqual(vscThread.state, vscode.CommentThreadState.Resolved);
            assert.strictEqual(vscThread.label, '✅ Resolved');
            assert.strictEqual(vscThread.canReply, false);
            assert.strictEqual(vscThread.contextValue, 'resolved');
        } finally {
            vscThread.dispose();
            controller.dispose();
        }
    });

    test('delete event removes single thread while other thread remains', async () => {
        const t1 = await store.addThread('a.ts', 1, 'Thread A');
        const t2 = await store.addThread('b.ts', 2, 'Thread B');
        events.length = 0;

        await store.deleteThread(t1.id);

        assert.strictEqual(events.length, 1, 'exactly one event after delete');
        assert.strictEqual(events[0].type, 'delete');
        assert.strictEqual(events[0].threadId, t1.id);
        assert.strictEqual(events[0].filePath, 'a.ts');
        assert.strictEqual(store.getThreads().length, 1, 'only 1 thread remains');
        assert.strictEqual(store.getThread(t1.id), undefined, 'deleted thread is gone');
        assert.ok(store.getThread(t2.id), 'other thread still exists');
    });

    test('resolve then unresolve round-trip toggles state correctly', async () => {
        const thread = await store.addThread('src/toggle.ts', 3, 'Toggle me');
        events.length = 0;

        // Resolve
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'update');

        // Unresolve
        await store.setThreadStatus(thread.id, 'open');
        assert.strictEqual(store.getThread(thread.id)!.status, 'open');
        assert.strictEqual(events.length, 2);
        assert.strictEqual(events[1].type, 'update');
        assert.strictEqual(events[1].threadId, thread.id);

        // Verify controller thread mirrors the full round-trip
        const { controller, thread: vscThread } = createTestThread('roundtrip', 'src/toggle.ts');
        try {
            applyThreadState(vscThread, 'resolved');
            assert.strictEqual(vscThread.state, vscode.CommentThreadState.Resolved);

            applyThreadState(vscThread, 'open');
            assert.strictEqual(vscThread.state, vscode.CommentThreadState.Unresolved);
            assert.strictEqual(vscThread.label, '💬 Open');
            assert.strictEqual(vscThread.canReply, true);
            assert.strictEqual(vscThread.contextValue, 'open');
        } finally {
            vscThread.dispose();
            controller.dispose();
        }
    });

    test('five rapid adds each fire individual add events', async () => {
        events.length = 0;

        const threads = [];
        for (let i = 0; i < 5; i++) {
            threads.push(await store.addThread(`file${i}.ts`, i + 1, `Thread ${i + 1}`));
        }

        assert.strictEqual(store.getThreads().length, 5, 'store has all 5 threads');
        assert.strictEqual(events.length, 5, 'exactly 5 events fired');

        for (let i = 0; i < 5; i++) {
            assert.strictEqual(events[i].type, 'add', `event ${i} is add`);
            assert.strictEqual(events[i].threadId, threads[i].id, `event ${i} has correct threadId`);
            assert.strictEqual(events[i].filePath, `file${i}.ts`, `event ${i} has correct filePath`);
        }

        // All thread IDs are unique
        const ids = new Set(events.map(e => e.threadId));
        assert.strictEqual(ids.size, 5, 'all 5 thread IDs are distinct');
    });

    // --- additional scoped-event coverage --------------------------------

    test('addComment fires update event (not add)', async () => {
        const thread = await store.addThread('src/test.ts', 1, 'Initial');
        events.length = 0;

        await store.addComment(thread.id, 'llm', 'AI reply');

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'update');
        assert.strictEqual(events[0].threadId, thread.id);
        assert.strictEqual(store.getThread(thread.id)!.comments.length, 2);
    });

    test('editComment fires update event', async () => {
        const thread = await store.addThread('src/test.ts', 1, 'Original');
        const commentId = thread.comments[0].id;
        events.length = 0;

        await store.editComment(thread.id, commentId, 'Edited');

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'update');
        assert.strictEqual(events[0].threadId, thread.id);
        assert.strictEqual(store.getThread(thread.id)!.comments[0].body, 'Edited');
    });

    test('filePath-only update event fires for adjustLineNumbers', async () => {
        await store.addThread('src/target.ts', 10, 'Move me');
        events.length = 0;

        await store.adjustLineNumbers('src/target.ts', 5, 3);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'update');
        assert.strictEqual(events[0].filePath, 'src/target.ts');
        assert.strictEqual(events[0].threadId, undefined, 'filePath-only event has no threadId');
        assert.strictEqual(store.getThreadsByFile('src/target.ts')[0].lineNumber, 13);
    });
});

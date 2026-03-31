import * as assert from 'assert';
import * as vscode from 'vscode';
import { ReviewStore } from '../../reviewStore';
import { ReviewNoteComment } from '../../commentController';
import {
    ThreadMapLookup,
    handleNewComment,
    handleReply,
    handleResolve,
    handleUnresolve,
    handleDelete,
    handleEditInline,
    handleSaveEdit,
    handleCancelEdit,
} from '../../commentCommands';
import type { ThreadChangeEvent } from '../../changeEvent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath);
}

function makeMockThread(uri: vscode.Uri, startLine: number): vscode.CommentThread {
    return {
        uri,
        range: new vscode.Range(startLine, 0, startLine, 0),
        comments: [],
        canReply: true,
        contextValue: '',
        label: undefined,
        state: vscode.CommentThreadState.Unresolved,
        dispose: () => {},
    } as unknown as vscode.CommentThread;
}

function makeLookup(idMap: Map<vscode.CommentThread, string>, threadMap: Map<string, vscode.CommentThread>, onSync?: () => void): ThreadMapLookup {
    return {
        getThreadId(thread: vscode.CommentThread): string | undefined {
            return idMap.get(thread);
        },
        getThreadMap(): Map<string, vscode.CommentThread> {
            return threadMap;
        },
        async syncFromStore(_event?: ThreadChangeEvent): Promise<void> {
            onSync?.();
        },
    };
}

function makeComment(threadId: string, commentId: string, body: string): ReviewNoteComment {
    return new ReviewNoteComment(
        body,
        vscode.CommentMode.Preview,
        { name: 'user' },
        threadId,
        commentId,
        body, // plainBody → savedBody
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('commentCommands — unit tests', () => {
    let store: ReviewStore;

    setup(() => {
        store = new ReviewStore();
    });

    teardown(() => {
        store.dispose();
    });

    // -- handleNewComment ---------------------------------------------------

    test('handleNewComment creates thread via store with correct path and line', async () => {
        const uri = makeUri('src/app.ts');
        const mockThread = makeMockThread(uri, 9); // 0-indexed line 9 → store line 10
        let disposed = false;
        mockThread.dispose = () => { disposed = true; };

        const reply: vscode.CommentReply = { thread: mockThread, text: 'REVIEW: fix this' };

        await handleNewComment(reply, store);

        const threads = store.getThreads();
        assert.strictEqual(threads.length, 1);
        assert.strictEqual(threads[0].filePath, 'src/app.ts');
        assert.strictEqual(threads[0].lineNumber, 10);
        assert.strictEqual(threads[0].comments[0].body, 'REVIEW: fix this');
        assert.ok(disposed, 'placeholder thread should be disposed');
    });

    // -- handleReply --------------------------------------------------------

    test('handleReply adds comment to the correct thread', async () => {
        const storeThread = await store.addThread('src/app.ts', 5, 'Initial');
        const uri = makeUri('src/app.ts');
        const mockThread = makeMockThread(uri, 4);

        const idMap = new Map<vscode.CommentThread, string>([[mockThread, storeThread.id]]);
        const lookup = makeLookup(idMap, new Map());

        const reply: vscode.CommentReply = { thread: mockThread, text: 'Follow-up' };
        await handleReply(reply, store, lookup);

        const updated = store.getThread(storeThread.id)!;
        assert.strictEqual(updated.comments.length, 2);
        assert.strictEqual(updated.comments[1].body, 'Follow-up');
        assert.strictEqual(updated.comments[1].author, 'user');
    });

    test('handleReply is a no-op for unknown thread', async () => {
        const mockThread = makeMockThread(makeUri('x.ts'), 0);
        const lookup = makeLookup(new Map(), new Map());
        const reply: vscode.CommentReply = { thread: mockThread, text: 'Orphan' };

        await handleReply(reply, store, lookup);
        assert.strictEqual(store.getThreads().length, 0);
    });

    // -- handleResolve ------------------------------------------------------

    test('handleResolve sets thread status to resolved', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Open');
        const mockThread = makeMockThread(makeUri('a.ts'), 0);
        const idMap = new Map<vscode.CommentThread, string>([[mockThread, storeThread.id]]);
        const lookup = makeLookup(idMap, new Map());

        await handleResolve(mockThread, store, lookup);

        assert.strictEqual(store.getThread(storeThread.id)!.status, 'resolved');
    });

    test('handleResolve is a no-op for unknown thread', async () => {
        const mockThread = makeMockThread(makeUri('a.ts'), 0);
        const lookup = makeLookup(new Map(), new Map());

        // Should not throw
        await handleResolve(mockThread, store, lookup);
    });

    // -- handleUnresolve ----------------------------------------------------

    test('handleUnresolve sets thread status to open', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Test');
        await store.setThreadStatus(storeThread.id, 'resolved');
        assert.strictEqual(store.getThread(storeThread.id)!.status, 'resolved');

        const mockThread = makeMockThread(makeUri('a.ts'), 0);
        const idMap = new Map<vscode.CommentThread, string>([[mockThread, storeThread.id]]);
        const lookup = makeLookup(idMap, new Map());

        await handleUnresolve(mockThread, store, lookup);

        assert.strictEqual(store.getThread(storeThread.id)!.status, 'open');
    });

    // -- handleDelete -------------------------------------------------------

    test('handleDelete removes the thread', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Delete me');
        const mockThread = makeMockThread(makeUri('a.ts'), 0);
        const idMap = new Map<vscode.CommentThread, string>([[mockThread, storeThread.id]]);
        const lookup = makeLookup(idMap, new Map());

        await handleDelete(mockThread, store, lookup);

        assert.strictEqual(store.getThreads().length, 0);
    });

    test('handleDelete is a no-op for unknown thread', async () => {
        await store.addThread('a.ts', 1, 'Keep');
        const mockThread = makeMockThread(makeUri('a.ts'), 0);
        const lookup = makeLookup(new Map(), new Map());

        await handleDelete(mockThread, store, lookup);

        assert.strictEqual(store.getThreads().length, 1, 'thread should not be deleted');
    });

    // -- handleEditInline ---------------------------------------------------

    test('handleEditInline switches comment to Editing mode with savedBody', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Original body');
        const comment = makeComment(storeThread.id, storeThread.comments[0].id, 'Rendered body');
        comment.savedBody = 'Plain text body';
        comment.mode = vscode.CommentMode.Preview;

        const vsThread = makeMockThread(makeUri('a.ts'), 0);
        vsThread.comments = [comment as unknown as vscode.Comment];

        const threadMap = new Map<string, vscode.CommentThread>([[storeThread.id, vsThread]]);
        const idMap = new Map<vscode.CommentThread, string>();
        const lookup = makeLookup(idMap, threadMap);

        handleEditInline(comment, lookup);

        assert.strictEqual(comment.mode, vscode.CommentMode.Editing);
        assert.strictEqual(comment.body, 'Plain text body');
    });

    test('handleEditInline refreshes thread.comments array', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Body');
        const comment = makeComment(storeThread.id, storeThread.comments[0].id, 'Body');

        const vsThread = makeMockThread(makeUri('a.ts'), 0);
        const originalComments = [comment as unknown as vscode.Comment];
        vsThread.comments = originalComments;

        const threadMap = new Map<string, vscode.CommentThread>([[storeThread.id, vsThread]]);
        const lookup = makeLookup(new Map(), threadMap);

        handleEditInline(comment, lookup);

        assert.notStrictEqual(vsThread.comments, originalComments, 'comments array should be a new reference');
    });

    test('handleEditInline is a no-op when comment has no threadId', () => {
        const comment = makeComment('', '', 'Body');
        const lookup = makeLookup(new Map(), new Map());

        handleEditInline(comment, lookup);

        assert.strictEqual(comment.mode, vscode.CommentMode.Preview, 'mode should remain Preview');
    });

    // -- handleSaveEdit -----------------------------------------------------

    test('handleSaveEdit calls store.editComment with trimmed body', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Original');
        const cid = storeThread.comments[0].id;
        const comment = makeComment(storeThread.id, cid, '  Updated text  ');

        await handleSaveEdit(comment, store);

        const updated = store.getThread(storeThread.id)!;
        assert.strictEqual(updated.comments[0].body, 'Updated text');
        assert.ok(updated.comments[0].editedAt, 'editedAt should be set');
    });

    test('handleSaveEdit works with MarkdownString body', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Original');
        const cid = storeThread.comments[0].id;
        const comment = makeComment(storeThread.id, cid, 'ignored');
        comment.body = new vscode.MarkdownString();
        (comment.body as vscode.MarkdownString).value = '  Markdown body  ';

        await handleSaveEdit(comment, store);

        assert.strictEqual(store.getThread(storeThread.id)!.comments[0].body, 'Markdown body');
    });

    test('handleSaveEdit is a no-op for empty/whitespace body', async () => {
        const storeThread = await store.addThread('a.ts', 1, 'Original');
        const cid = storeThread.comments[0].id;
        const comment = makeComment(storeThread.id, cid, '   ');

        await handleSaveEdit(comment, store);

        assert.strictEqual(store.getThread(storeThread.id)!.comments[0].body, 'Original');
    });

    test('handleSaveEdit is a no-op when comment has no ids', async () => {
        const comment = makeComment('', '', 'Text');
        // Should not throw
        await handleSaveEdit(comment, store);
    });

    // -- handleCancelEdit ---------------------------------------------------

    test('handleCancelEdit calls syncFromStore', () => {
        let synced = false;
        const lookup = makeLookup(new Map(), new Map(), () => { synced = true; });

        handleCancelEdit(lookup);

        assert.ok(synced, 'syncFromStore should have been called');
    });
});

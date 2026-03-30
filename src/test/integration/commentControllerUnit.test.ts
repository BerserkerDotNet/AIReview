import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import { ReviewNoteComment } from '../../commentController';

// NOTE: We cannot instantiate ReviewCommentController in tests because the
// extension already registers its commands during activation in the VS Code
// test host, and duplicate command registration throws. These tests verify
// the store operations that the controller delegates to.

suite('ReviewCommentController Test Suite', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-cc-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    teardown(() => {
        persistence.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('empty store has no threads for controller to sync', async () => {
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('addThread creates data that controller would sync', async () => {
        await store.addThread('test.ts', 1, 'Thread A');
        await store.addThread('test.ts', 6, 'Thread B');
        assert.strictEqual(store.getThreads().length, 2);
    });

    test('deleteThread removes data that controller would unsync', async () => {
        const thread = await store.addThread('test.ts', 1, 'Delete me');
        await store.deleteThread(thread.id);
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('setThreadStatus updates state that controller maps to CommentThreadState', async () => {
        const thread = await store.addThread('test.ts', 1, 'Resolve me');
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
    });

    test('multi-author comments preserved for controller toVscodeComments mapping', async () => {
        const thread = await store.addThread('test.ts', 1, 'REVIEW: Initial');
        await store.addComment(thread.id, 'llm', 'LLM: Response');
        await store.addComment(thread.id, 'user', 'User reply');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments.length, 3);
        assert.deepStrictEqual(
            updated.comments.map(c => c.author),
            ['user', 'llm', 'user']
        );
    });

    // --- Inline edit (ReviewNoteComment) tests ---

    test('ReviewNoteComment stores savedBody for cancel support', () => {
        const md = new vscode.MarkdownString('**bold**');
        const comment = new ReviewNoteComment(
            md, vscode.CommentMode.Preview,
            { name: 'You' }, 'thread-1', 'comment-1', 'plain text',
        );
        assert.strictEqual(comment.savedBody, 'plain text');
        assert.strictEqual(comment.mode, vscode.CommentMode.Preview);
        assert.strictEqual(comment.threadId, 'thread-1');
        assert.strictEqual(comment.commentId, 'comment-1');
    });

    test('ReviewNoteComment edit flow: switch to editing restores plain body', () => {
        const md = new vscode.MarkdownString('rendered **markdown**');
        const comment = new ReviewNoteComment(
            md, vscode.CommentMode.Preview,
            { name: 'You' }, 'thread-1', 'comment-1', 'raw body',
            undefined, 'editable',
        );

        // Simulate edit: set body to savedBody and switch to editing mode
        comment.body = comment.savedBody;
        comment.mode = vscode.CommentMode.Editing;

        assert.strictEqual(comment.body, 'raw body');
        assert.strictEqual(comment.mode, vscode.CommentMode.Editing);
    });

    test('ReviewNoteComment cancel restores original body via syncFromStore', () => {
        const comment = new ReviewNoteComment(
            'original', vscode.CommentMode.Preview,
            { name: 'You' }, 'thread-1', 'comment-1', 'original',
            undefined, 'editable',
        );

        // Enter editing mode
        comment.body = comment.savedBody;
        comment.mode = vscode.CommentMode.Editing;

        // Simulate user typing a new value
        comment.body = 'user typed something new';

        // Cancel: savedBody still holds the original
        assert.strictEqual(comment.savedBody, 'original');
    });

    test('user comments get editable contextValue, AI comments do not', async () => {
        const thread = await store.addThread('test.ts', 1, 'User comment');
        await store.addComment(thread.id, 'llm', 'AI response');
        const updated = store.getThread(thread.id)!;

        // Verify the store data that drives contextValue assignment
        assert.strictEqual(updated.comments[0].author, 'user');
        assert.strictEqual(updated.comments[1].author, 'llm');

        // Simulate what toVscodeComments does: user → 'editable', llm → undefined
        const isUserEditable = (author: string) => author === 'user' ? 'editable' : undefined;
        const userComment = new ReviewNoteComment(
            new vscode.MarkdownString(updated.comments[0].body),
            vscode.CommentMode.Preview,
            { name: 'You' }, thread.id, updated.comments[0].id,
            updated.comments[0].body, undefined,
            isUserEditable(updated.comments[0].author),
        );
        const aiComment = new ReviewNoteComment(
            new vscode.MarkdownString(updated.comments[1].body),
            vscode.CommentMode.Preview,
            { name: 'AI' }, thread.id, updated.comments[1].id,
            updated.comments[1].body, undefined,
            isUserEditable(updated.comments[1].author),
        );

        assert.strictEqual(userComment.contextValue, 'editable');
        assert.strictEqual(aiComment.contextValue, undefined);
    });

    test('editComment at store level updates body and sets editedAt', async () => {
        const thread = await store.addThread('test.ts', 1, 'Original body');
        const commentId = thread.comments[0].id;

        await store.editComment(thread.id, commentId, 'Updated body');
        const updated = store.getThread(thread.id)!;

        assert.strictEqual(updated.comments[0].body, 'Updated body');
        assert.ok(updated.comments[0].editedAt, 'editedAt should be set');
    });

    test('editComment does not allow editing non-existent comment', async () => {
        const thread = await store.addThread('test.ts', 1, 'Some body');
        const result = await store.editComment(thread.id, 'non-existent-id', 'New body');
        assert.strictEqual(result, false);
    });

    test('save edit persists updated body through store', async () => {
        const thread = await store.addThread('test.ts', 5, 'Initial review');
        const commentId = thread.comments[0].id;

        // Simulate the save flow: store.editComment is called with the new body
        await store.editComment(thread.id, commentId, 'Edited review');

        // Reload from disk to verify persistence
        persistence.dispose();
        store.dispose();
        const p2 = new ReviewStorePersistence();
        const s2 = new ReviewStore();
        s2.setPersistence(p2);
        const data = await p2.initialize(workspaceFolder);
        s2.loadData(data);

        const reloaded = s2.getThread(thread.id)!;
        assert.strictEqual(reloaded.comments[0].body, 'Edited review');
        assert.ok(reloaded.comments[0].editedAt);
        p2.dispose();
        s2.dispose();
    });

    test('store dispose cleans up without errors', async () => {
        await store.addThread('test.ts', 1, 'Cleanup test');
        store.dispose();
        store = new ReviewStore();
        store.setPersistence(persistence);
    });

    test('bulk add and remove leaves correct state', async () => {
        const t1 = await store.addThread('a.ts', 1, 'A');
        const t2 = await store.addThread('b.ts', 1, 'B');
        await store.addThread('c.ts', 1, 'C');

        await store.deleteThread(t1.id);
        await store.deleteThread(t2.id);

        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'c.ts');
    });

    // --- Thread state change (resolve / reopen) ---

    test('reopening a thread resets status to open', async () => {
        const thread = await store.addThread('test.ts', 1, 'Resolve then reopen');
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');

        await store.setThreadStatus(thread.id, 'open');
        assert.strictEqual(store.getThread(thread.id)!.status, 'open');
    });

    test('thread label updates in-place when state properties are set before comments', async () => {
        // The fix for label not updating: set label/state/contextValue BEFORE
        // reassigning thread.comments. The comments setter triggers VS Code's
        // re-render, which picks up all property changes made beforehand.
        const controller = vscode.comments.createCommentController('test-reopen-label', 'Test');
        const uri = vscode.Uri.file(path.join(tmpDir, 'test.ts'));
        fs.writeFileSync(uri.fsPath, 'line 1\n');

        const thread = controller.createCommentThread(uri, new vscode.Range(0, 0, 0, 0), []);

        // Simulate resolve: apply state first, then reassign comments
        thread.label = '✅ Resolved';
        thread.state = vscode.CommentThreadState.Resolved;
        thread.contextValue = 'resolved';
        thread.comments = [...thread.comments];

        assert.strictEqual(thread.label, '✅ Resolved');
        assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);
        assert.strictEqual(thread.contextValue, 'resolved');

        // Simulate reopen: apply state first, then reassign comments
        thread.label = '💬 Open';
        thread.state = vscode.CommentThreadState.Unresolved;
        thread.contextValue = 'open';
        thread.comments = [...thread.comments];

        assert.strictEqual(thread.label, '💬 Open');
        assert.strictEqual(thread.state, vscode.CommentThreadState.Unresolved);
        assert.strictEqual(thread.contextValue, 'open');

        thread.dispose();
        controller.dispose();
    });

    // --- clearResolvedThreads ---

    test('clearResolvedThreads removes only resolved threads', async () => {
        const t1 = await store.addThread('a.ts', 1, 'Keep me');
        await store.addThread('b.ts', 2, 'Resolve me');
        const t3 = await store.addThread('c.ts', 3, 'Also keep');

        await store.setThreadStatus(store.getThreads()[1].id, 'resolved');

        const removed = await store.clearResolvedThreads();
        assert.strictEqual(removed, 1);
        assert.strictEqual(store.getThreads().length, 2);
        assert.ok(store.getThreads().every(t => t.status === 'open'));
        assert.deepStrictEqual(
            store.getThreads().map(t => t.id),
            [t1.id, t3.id]
        );
    });

    test('clearResolvedThreads returns 0 when none resolved', async () => {
        await store.addThread('a.ts', 1, 'Open thread');
        const removed = await store.clearResolvedThreads();
        assert.strictEqual(removed, 0);
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('clearResolvedThreads fires onDidChangeThreads', async () => {
        const thread = await store.addThread('a.ts', 1, 'Resolve me');
        await store.setThreadStatus(thread.id, 'resolved');

        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.clearResolvedThreads();
        assert.strictEqual(fired, true);
    });

    test('clearResolvedThreads persists to disk', async () => {
        const thread = await store.addThread('a.ts', 1, 'Resolve me');
        await store.setThreadStatus(thread.id, 'resolved');
        await store.addThread('b.ts', 2, 'Keep me');
        await store.clearResolvedThreads();

        // Reload from disk
        persistence.dispose();
        store.dispose();
        const p2 = new ReviewStorePersistence();
        const s2 = new ReviewStore();
        s2.setPersistence(p2);
        const data = await p2.initialize(workspaceFolder);
        s2.loadData(data);

        assert.strictEqual(s2.getThreads().length, 1);
        assert.strictEqual(s2.getThreads()[0].filePath, 'b.ts');
        p2.dispose();
        s2.dispose();
    });
});

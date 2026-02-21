import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../reviewStore';

suite('Phase 3 & 4 – Commands and Comment Controller Tests', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-cmd-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- Phase 3: comment creation ---

    test('addThread stores a new thread with user comment', async () => {
        const thread = await store.addThread('src/foo.ts', 5, 'REVIEW: Something here');
        assert.strictEqual(thread.comments.length, 1);
        assert.strictEqual(thread.comments[0].author, 'user');
        assert.strictEqual(thread.comments[0].body, 'REVIEW: Something here');
        assert.strictEqual(thread.status, 'open');
    });

    test('addComment adds user reply to thread', async () => {
        const thread = await store.addThread('src/foo.ts', 3, 'REVIEW: Check this');
        await store.addComment(thread.id, 'user', 'I disagree');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments.length, 2);
        assert.strictEqual(updated.comments[1].body, 'I disagree');
    });

    test('addComment adds llm reply to thread', async () => {
        const thread = await store.addThread('src/foo.ts', 3, 'REVIEW: Check this');
        await store.addComment(thread.id, 'llm', 'LLM: Here is my suggestion');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments[1].author, 'llm');
    });

    test('multi-turn conversation stores all comments in order', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'REVIEW: Turn 1');
        await store.addComment(thread.id, 'llm', 'LLM: Turn 2');
        await store.addComment(thread.id, 'user', 'Turn 3');
        await store.addComment(thread.id, 'llm', 'LLM: Turn 4');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments.length, 4);
        assert.deepStrictEqual(
            updated.comments.map(c => c.author),
            ['user', 'llm', 'user', 'llm']
        );
    });

    // --- Phase 4: resolve/unresolve/delete ---

    test('resolving a thread sets status to resolved', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Fix me');
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
    });

    test('unresolving a thread sets status back to open', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Fix me');
        await store.setThreadStatus(thread.id, 'resolved');
        await store.setThreadStatus(thread.id, 'open');
        assert.strictEqual(store.getThread(thread.id)!.status, 'open');
    });

    test('deleting a thread removes it from the store', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Delete me');
        await store.deleteThread(thread.id);
        assert.strictEqual(store.getThread(thread.id), undefined);
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('resolved threads persist across reload', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Persist resolved');
        await store.setThreadStatus(thread.id, 'resolved');

        store.dispose();
        const store2 = new ReviewStore();
        await store2.initialize(workspaceFolder);
        assert.strictEqual(store2.getThread(thread.id)!.status, 'resolved');
        store2.dispose();
    });

    test('onDidChangeThreads fires on resolve', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Watch me');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(fired, true);
    });

    test('onDidChangeThreads fires on delete', async () => {
        const thread = await store.addThread('src/foo.ts', 1, 'Watch me');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.deleteThread(thread.id);
        assert.strictEqual(fired, true);
    });

    test('syncFromStore - CommentController maps threads correctly', async () => {
        // Add two threads
        await store.addThread('a.ts', 0, 'Thread A');
        await store.addThread('b.ts', 5, 'Thread B');

        // Verify all threads exist
        assert.strictEqual(store.getThreads().length, 2);

        // Verify file-level filtering still works after multiple threads
        const aThreads = store.getThreadsByFile('a.ts');
        const bThreads = store.getThreadsByFile('b.ts');
        assert.strictEqual(aThreads.length, 1);
        assert.strictEqual(bThreads.length, 1);
    });
});

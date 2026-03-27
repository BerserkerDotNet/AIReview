import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';

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
});

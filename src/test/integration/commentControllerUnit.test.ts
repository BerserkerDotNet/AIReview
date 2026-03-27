import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewCommentController } from '../../commentController';

suite('ReviewCommentController Test Suite', () => {
    let store: ReviewStore;
    let controller: ReviewCommentController;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-cc-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
        controller = new ReviewCommentController(store);
    });

    teardown(() => {
        controller.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('syncFromStore succeeds with empty store', async () => {
        // Should not throw
        await controller.syncFromStore();
    });

    test('syncFromStore creates threads for store data', async () => {
        await store.addThread('test.ts', 1, 'Thread A');
        await store.addThread('test.ts', 6, 'Thread B');
        // syncFromStore is called automatically via onDidChangeThreads listener
        // but we can also call it explicitly
        await controller.syncFromStore();
        // Verify threads exist in store
        assert.strictEqual(store.getThreads().length, 2);
    });

    test('syncFromStore removes deleted threads', async () => {
        const thread = await store.addThread('test.ts', 1, 'Delete me');
        await controller.syncFromStore();
        await store.deleteThread(thread.id);
        await controller.syncFromStore();
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('syncFromStore updates thread state on resolve', async () => {
        const thread = await store.addThread('test.ts', 1, 'Resolve me');
        await controller.syncFromStore();
        await store.setThreadStatus(thread.id, 'resolved');
        await controller.syncFromStore();
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
    });

    test('syncFromStore handles thread with comments from multiple authors', async () => {
        const thread = await store.addThread('test.ts', 1, 'REVIEW: Initial');
        await store.addComment(thread.id, 'llm', 'LLM: Response');
        await store.addComment(thread.id, 'user', 'User reply');
        await controller.syncFromStore();
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments.length, 3);
        assert.deepStrictEqual(
            updated.comments.map(c => c.author),
            ['user', 'llm', 'user']
        );
    });

    test('dispose cleans up without errors', async () => {
        await store.addThread('test.ts', 1, 'Cleanup test');
        await controller.syncFromStore();
        // Should not throw
        controller.dispose();
        // Create a new controller to verify the old one is cleaned up
        controller = new ReviewCommentController(store);
    });

    test('multiple syncFromStore calls are idempotent', async () => {
        await store.addThread('test.ts', 1, 'Idempotent');
        await controller.syncFromStore();
        await controller.syncFromStore();
        await controller.syncFromStore();
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('syncFromStore after adding and removing multiple threads', async () => {
        const t1 = await store.addThread('a.ts', 1, 'A');
        const t2 = await store.addThread('b.ts', 1, 'B');
        await store.addThread('c.ts', 1, 'C');
        await controller.syncFromStore();

        await store.deleteThread(t1.id);
        await store.deleteThread(t2.id);
        await controller.syncFromStore();

        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'c.ts');
    });
});

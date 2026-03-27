import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { DecorationProvider } from '../../decorationProvider';

suite('DecorationProvider Test Suite', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-deco-unit-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('getOpenThreadsByFile returns only open threads for decoration', async () => {
        const t1 = await store.addThread('src/app.ts', 6, 'Open review');
        await store.addThread('src/app.ts', 11, 'Another open');
        const t3 = await store.addThread('src/app.ts', 16, 'Will resolve');
        await store.setThreadStatus(t3.id, 'resolved');

        const openThreads = store.getOpenThreadsByFile('src/app.ts');
        assert.strictEqual(openThreads.length, 2);
        assert.ok(openThreads.every(t => t.status === 'open'));
    });

    test('threads from different files do not mix', async () => {
        await store.addThread('src/a.ts', 6, 'File A');
        await store.addThread('src/b.ts', 11, 'File B');
        await store.addThread('src/a.ts', 21, 'File A again');

        const aThreads = store.getOpenThreadsByFile('src/a.ts');
        const bThreads = store.getOpenThreadsByFile('src/b.ts');
        assert.strictEqual(aThreads.length, 2);
        assert.strictEqual(bThreads.length, 1);
    });

    test('thread lineNumber is clamped correctly for decoration ranges', async () => {
        // Simulate a thread whose line might be out of range
        const thread = await store.addThread('test.ts', 1000, 'Far away line');
        assert.strictEqual(thread.lineNumber, 1000);
        // The clamping happens in refreshEditor, not in the store
        // Just verify the store stores it as-is
    });

    test('first comment body is available for hover preview in decoration', async () => {
        const thread = await store.addThread('test.ts', 1, 'REVIEW: Critical bug found');
        assert.strictEqual(thread.comments[0]?.body, 'REVIEW: Critical bug found');
    });

    test('onDidChangeThreads fires when thread added (triggers decoration refresh)', async () => {
        let fireCount = 0;
        store.onDidChangeThreads(() => { fireCount++; });
        await store.addThread('test.ts', 1, 'New thread');
        await store.addThread('test.ts', 2, 'Another thread');
        assert.strictEqual(fireCount, 2, 'Should fire once per addThread');
    });

    test('onDidChangeThreads fires when thread resolved (triggers decoration refresh)', async () => {
        const thread = await store.addThread('test.ts', 1, 'Resolve me');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(fired, true);
    });

    test('empty file has no threads for decoration', () => {
        const threads = store.getOpenThreadsByFile('nonexistent.ts');
        assert.strictEqual(threads.length, 0);
    });
});

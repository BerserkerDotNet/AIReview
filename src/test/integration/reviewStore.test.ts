import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';

suite('ReviewStore — Extended Tests', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-ext-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- editComment tests (UNTESTED method) ---

    test('editComment updates comment body', async () => {
        const thread = await store.addThread('src/app.ts', 6, 'Original body');
        const commentId = thread.comments[0].id;
        const ok = await store.editComment(thread.id, commentId, 'Updated body');
        assert.strictEqual(ok, true);
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments[0].body, 'Updated body');
    });

    test('editComment sets editedAt timestamp', async () => {
        const thread = await store.addThread('src/app.ts', 6, 'Original');
        const commentId = thread.comments[0].id;
        assert.strictEqual(thread.comments[0].editedAt, undefined);
        await store.editComment(thread.id, commentId, 'Edited');
        const updated = store.getThread(thread.id)!;
        assert.ok(updated.comments[0].editedAt);
    });

    test('editComment returns false for unknown thread', async () => {
        const ok = await store.editComment('bad-thread', 'bad-comment', 'nope');
        assert.strictEqual(ok, false);
    });

    test('editComment returns false for unknown comment', async () => {
        const thread = await store.addThread('src/app.ts', 6, 'Body');
        const ok = await store.editComment(thread.id, 'nonexistent', 'nope');
        assert.strictEqual(ok, false);
    });

    test('editComment fires onDidChangeThreads', async () => {
        const thread = await store.addThread('src/app.ts', 6, 'Original');
        const commentId = thread.comments[0].id;
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.editComment(thread.id, commentId, 'Changed');
        assert.strictEqual(fired, true);
    });

    test('editComment persists to disk', async () => {
        const thread = await store.addThread('src/app.ts', 6, 'Original');
        const commentId = thread.comments[0].id;
        await store.editComment(thread.id, commentId, 'Persisted edit');
        store.dispose();

        const store2 = new ReviewStore();
        await store2.initialize(workspaceFolder);
        const reloaded = store2.getThread(thread.id)!;
        assert.strictEqual(reloaded.comments[0].body, 'Persisted edit');
        store2.dispose();
    });

    // --- getOpenThreadsByFile tests ---

    test('getOpenThreadsByFile returns only open threads', async () => {
        const t1 = await store.addThread('src/app.ts', 2, 'Open');
        const t2 = await store.addThread('src/app.ts', 3, 'Will resolve');
        await store.addThread('src/app.ts', 4, 'Also open');
        await store.setThreadStatus(t2.id, 'resolved');
        const open = store.getOpenThreadsByFile('src/app.ts');
        assert.strictEqual(open.length, 2);
        assert.ok(open.every(t => t.status === 'open'));
    });

    test('getOpenThreadsByFile returns empty for unknown file', () => {
        const result = store.getOpenThreadsByFile('nonexistent.ts');
        assert.strictEqual(result.length, 0);
    });

    // --- getThreadByFileAndLine tests ---

    test('getThreadByFileAndLine finds thread on exact line', async () => {
        await store.addThread('src/app.ts', 11, 'Target');
        const found = store.getThreadByFileAndLine('src/app.ts', 11);
        assert.ok(found);
        assert.strictEqual(found!.lineNumber, 11);
    });

    test('getThreadByFileAndLine returns undefined for wrong line', async () => {
        await store.addThread('src/app.ts', 11, 'Target');
        const found = store.getThreadByFileAndLine('src/app.ts', 12);
        assert.strictEqual(found, undefined);
    });

    test('getThreadByFileAndLine ignores resolved threads', async () => {
        const t = await store.addThread('src/app.ts', 11, 'Resolved');
        await store.setThreadStatus(t.id, 'resolved');
        const found = store.getThreadByFileAndLine('src/app.ts', 11);
        assert.strictEqual(found, undefined);
    });

    // --- Edge cases for adjustLineNumbers ---

    test('adjustLineNumbers with thread on line 0', async () => {
        const thread = await store.addThread('src/a.ts', 1, 'Line zero');
        await store.adjustLineNumbers('src/a.ts', 1, 3);
        // Thread at line 0, change at line 0: lineNumber > changeStart is false (0 > 0), so no shift
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 1);
    });

    test('adjustLineNumbers clamps to 0 when deletion would go negative', async () => {
        const thread = await store.addThread('src/a.ts', 2, 'Low line');
        await store.adjustLineNumbers('src/a.ts', 1, -5);
        assert.ok(store.getThread(thread.id)!.lineNumber >= 0);
    });

    test('adjustLineNumbers with multiple threads in same file', async () => {
        const t1 = await store.addThread('src/a.ts', 3, 'Thread at 2');
        const t2 = await store.addThread('src/a.ts', 6, 'Thread at 5');
        const t3 = await store.addThread('src/a.ts', 11, 'Thread at 10');
        // Insert 3 lines at line 4
        await store.adjustLineNumbers('src/a.ts', 5, 3);
        assert.strictEqual(store.getThread(t1.id)!.lineNumber, 3); // below change, unchanged
        assert.strictEqual(store.getThread(t2.id)!.lineNumber, 9); // 5+3
        assert.strictEqual(store.getThread(t3.id)!.lineNumber, 14); // 10+3
    });

    // --- Edge cases for remapThreadsForRename ---

    test('remapThreadsForRename with empty strings', async () => {
        await store.addThread('src/app.ts', 2, 'Should not change');
        const changed = await store.remapThreadsForRename('', 'new');
        assert.strictEqual(changed, 0);
    });

    test('remapThreadsForRename with same old and new path', async () => {
        await store.addThread('src/app.ts', 2, 'Should not change');
        const changed = await store.remapThreadsForRename('src/app.ts', 'src/app.ts');
        assert.strictEqual(changed, 0);
    });

    // --- Edge cases for removeThreadsForDeletedPath ---

    test('removeThreadsForDeletedPath with empty string', async () => {
        await store.addThread('src/app.ts', 2, 'Keep me');
        const removed = await store.removeThreadsForDeletedPath('');
        assert.strictEqual(removed, 0);
        assert.strictEqual(store.getThreads().length, 1);
    });

    // --- Special characters ---

    test('thread with special characters in body', async () => {
        const body = 'REVIEW: Fix "quotes" & <tags> with `backticks`';
        const thread = await store.addThread('src/app.ts', 2, body);
        assert.strictEqual(thread.comments[0].body, body);
        // Verify persistence
        store.dispose();
        const store2 = new ReviewStore();
        await store2.initialize(workspaceFolder);
        assert.strictEqual(store2.getThread(thread.id)!.comments[0].body, body);
        store2.dispose();
    });
});

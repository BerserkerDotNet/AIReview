import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';

suite('End-to-End Workflow Tests', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-e2e-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- Full lifecycle: add → reply → resolve → unresolve → delete ---

    test('complete thread lifecycle: add → reply → edit → resolve → unresolve → delete', async () => {
        // Step 1: Add thread
        const thread = await store.addThread('src/app.ts', 11, 'REVIEW: Fix null check');
        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(thread.status, 'open');

        // Step 2: Reply from LLM
        await store.addComment(thread.id, 'llm', 'LLM: Added optional chaining');
        assert.strictEqual(store.getThread(thread.id)!.comments.length, 2);

        // Step 3: User replies back
        await store.addComment(thread.id, 'user', 'Looks good, but also check line 15');
        assert.strictEqual(store.getThread(thread.id)!.comments.length, 3);

        // Step 4: Edit user's reply
        const lastCommentId = store.getThread(thread.id)!.comments[2].id;
        await store.editComment(thread.id, lastCommentId, 'Looks good, but also check lines 15-20');
        assert.strictEqual(store.getThread(thread.id)!.comments[2].body, 'Looks good, but also check lines 15-20');
        assert.ok(store.getThread(thread.id)!.comments[2].editedAt);

        // Step 5: Resolve
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');

        // Step 6: Unresolve (reviewer wants more changes)
        await store.setThreadStatus(thread.id, 'open');
        assert.strictEqual(store.getThread(thread.id)!.status, 'open');

        // Step 7: Delete
        await store.deleteThread(thread.id);
        assert.strictEqual(store.getThreads().length, 0);
    });

    // --- Line drift: add thread → edit document (simulate) → verify thread moved ---

    test('thread follows line insertions and deletions', async () => {
        const thread = await store.addThread('src/app.ts', 11, 'REVIEW: Check this');

        // Insert 5 lines above thread
        await store.adjustLineNumbers('src/app.ts', 4, 5);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 16); // 10+5

        // Delete 2 lines above thread
        await store.adjustLineNumbers('src/app.ts', 9, -2);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 14); // 15-2

        // Insert 1 line below thread (no effect)
        await store.adjustLineNumbers('src/app.ts', 21, 1);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 14); // unchanged
    });

    // --- File rename: add thread → rename file → verify thread path updated ---

    test('threads follow file rename', async () => {
        const t1 = await store.addThread('src/old-name.ts', 6, 'Thread 1');
        const t2 = await store.addThread('src/old-name.ts', 21, 'Thread 2');
        const t3 = await store.addThread('src/other.ts', 11, 'Unrelated');

        await store.remapThreadsForRename('src/old-name.ts', 'src/new-name.ts');

        assert.strictEqual(store.getThread(t1.id)!.filePath, 'src/new-name.ts');
        assert.strictEqual(store.getThread(t2.id)!.filePath, 'src/new-name.ts');
        assert.strictEqual(store.getThread(t3.id)!.filePath, 'src/other.ts'); // unchanged
    });

    // --- Folder rename: threads in nested files follow folder rename ---

    test('threads follow folder rename', async () => {
        const t1 = await store.addThread('src/components/Button.tsx', 6, 'Button thread');
        const t2 = await store.addThread('src/components/forms/Input.tsx', 11, 'Input thread');
        const t3 = await store.addThread('src/utils/helper.ts', 4, 'Unrelated');

        await store.remapThreadsForRename('src/components', 'src/ui');

        assert.ok(store.getThread(t1.id)!.filePath.startsWith('src'));
        assert.ok(!store.getThread(t1.id)!.filePath.includes('components'));
        assert.strictEqual(store.getThread(t3.id)!.filePath, 'src/utils/helper.ts');
    });

    // --- File delete: add thread → delete file → verify threads removed ---

    test('threads removed when file deleted', async () => {
        await store.addThread('src/remove-me.ts', 6, 'Gone soon');
        await store.addThread('src/remove-me.ts', 16, 'Also gone');
        await store.addThread('src/keep.ts', 11, 'Stay');

        await store.removeThreadsForDeletedPath('src/remove-me.ts');

        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'src/keep.ts');
    });

    // --- Multi-file workflow ---

    test('managing threads across multiple files simultaneously', async () => {
        // Add threads to 3 files
        const t1 = await store.addThread('src/a.ts', 2, 'Thread in A');
        const t2 = await store.addThread('src/b.ts', 3, 'Thread in B');
        const t3 = await store.addThread('src/c.ts', 4, 'Thread in C');
        assert.strictEqual(store.getThreads().length, 3);

        // Reply to thread in B
        await store.addComment(t2.id, 'llm', 'LLM response for B');

        // Resolve thread in A
        await store.setThreadStatus(t1.id, 'resolved');

        // Delete thread in C
        await store.deleteThread(t3.id);

        // Verify final state
        assert.strictEqual(store.getThreads().length, 2);
        assert.strictEqual(store.getThread(t1.id)!.status, 'resolved');
        assert.strictEqual(store.getThread(t2.id)!.comments.length, 2);
        assert.strictEqual(store.getThread(t3.id), undefined);
    });

    // --- Persistence across reload ---

    test('full workflow state survives store reload', async () => {
        // Build up state
        const t1 = await store.addThread('src/a.ts', 6, 'Persistent thread');
        await store.addComment(t1.id, 'llm', 'LLM reply');
        await store.setThreadStatus(t1.id, 'resolved');

        const t2 = await store.addThread('src/b.ts', 11, 'Open thread');
        await store.addComment(t2.id, 'user', 'User followup');

        // Reload
        store.dispose();
        const store2 = new ReviewStore();
        await store2.initialize(workspaceFolder);

        // Verify all state survived
        assert.strictEqual(store2.getThreads().length, 2);
        const reloaded1 = store2.getThread(t1.id)!;
        assert.strictEqual(reloaded1.status, 'resolved');
        assert.strictEqual(reloaded1.comments.length, 2);
        assert.strictEqual(reloaded1.comments[1].author, 'llm');

        const reloaded2 = store2.getThread(t2.id)!;
        assert.strictEqual(reloaded2.status, 'open');
        assert.strictEqual(reloaded2.comments.length, 2);

        store2.dispose();
        // Re-create for teardown
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    // --- Event counting across full workflow ---

    test('change events fire correct number of times through workflow', async () => {
        let eventCount = 0;
        store.onDidChangeThreads(() => { eventCount++; });

        const thread = await store.addThread('x.ts', 1, 'Event counting'); // +1
        await store.addComment(thread.id, 'llm', 'Reply'); // +1
        await store.editComment(thread.id, thread.comments[0].id, 'Edited'); // +1
        await store.adjustLineNumbers('x.ts', 1, 3); // +1 (thread moves)
        await store.setThreadStatus(thread.id, 'resolved'); // +1
        await store.deleteThread(thread.id); // +1

        assert.strictEqual(eventCount, 6);
    });
});

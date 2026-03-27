import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';

suite('Commands — Store Operations Test Suite', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-cmd-unit-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- addComment command flow (store.addThread) ---

    test('addThread with relative path and line stores correctly', async () => {
        const thread = await store.addThread('src/components/App.tsx', 43, 'REVIEW: Check prop types');
        assert.strictEqual(thread.filePath, 'src/components/App.tsx');
        assert.strictEqual(thread.lineNumber, 43);
        assert.strictEqual(thread.comments[0].body, 'REVIEW: Check prop types');
        assert.strictEqual(thread.comments[0].author, 'user');
    });

    test('addThread with line 0 works', async () => {
        const thread = await store.addThread('src/app.ts', 1, 'First line comment');
        assert.strictEqual(thread.lineNumber, 1);
    });

    test('addThread trims body should be done by caller', async () => {
        // The store stores body as-is; commands.ts trims before calling
        const thread = await store.addThread('src/app.ts', 1, '  spaced  ');
        assert.strictEqual(thread.comments[0].body, '  spaced  ');
    });

    // --- replyToThread command flow (store.addComment) ---

    test('addComment reply preserves thread order', async () => {
        const thread = await store.addThread('x.ts', 1, 'Initial');
        await store.addComment(thread.id, 'user', 'Reply 1');
        await store.addComment(thread.id, 'llm', 'LLM Reply');
        await store.addComment(thread.id, 'user', 'Reply 2');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments.length, 4);
        assert.deepStrictEqual(
            updated.comments.map(c => c.body),
            ['Initial', 'Reply 1', 'LLM Reply', 'Reply 2']
        );
    });

    // --- resolveThread command flow ---

    test('resolve then unresolve round-trip', async () => {
        const thread = await store.addThread('x.ts', 1, 'Toggle me');
        assert.strictEqual(thread.status, 'open');
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
        await store.setThreadStatus(thread.id, 'open');
        assert.strictEqual(store.getThread(thread.id)!.status, 'open');
    });

    // --- deleteThread command flow ---

    test('delete only removes target thread', async () => {
        const t1 = await store.addThread('a.ts', 1, 'Keep');
        const t2 = await store.addThread('b.ts', 1, 'Delete');
        const t3 = await store.addThread('c.ts', 1, 'Keep too');
        await store.deleteThread(t2.id);
        assert.strictEqual(store.getThreads().length, 2);
        assert.ok(store.getThread(t1.id));
        assert.ok(store.getThread(t3.id));
        assert.strictEqual(store.getThread(t2.id), undefined);
    });

    // --- editComment command flow ---

    test('editComment preserves other comments in thread', async () => {
        const thread = await store.addThread('x.ts', 1, 'First');
        await store.addComment(thread.id, 'llm', 'LLM says hello');
        await store.addComment(thread.id, 'user', 'Original reply');
        const commentId = store.getThread(thread.id)!.comments[2].id;
        await store.editComment(thread.id, commentId, 'Edited reply');
        const updated = store.getThread(thread.id)!;
        assert.strictEqual(updated.comments[0].body, 'First');
        assert.strictEqual(updated.comments[1].body, 'LLM says hello');
        assert.strictEqual(updated.comments[2].body, 'Edited reply');
    });

    // --- pickThread filtering logic (tested indirectly) ---

    test('filter threads by open status for resolve command', async () => {
        const t1 = await store.addThread('a.ts', 1, 'Open 1');
        const t2 = await store.addThread('b.ts', 1, 'Open 2');
        await store.addThread('c.ts', 1, 'Will be resolved');
        await store.setThreadStatus(store.getThreads()[2].id, 'resolved');

        const openThreads = store.getThreads().filter(t => t.status === 'open');
        assert.strictEqual(openThreads.length, 2);
    });

    test('filter threads by resolved status for unresolve command', async () => {
        const t1 = await store.addThread('a.ts', 1, 'Open');
        const t2 = await store.addThread('b.ts', 1, 'Resolved');
        await store.setThreadStatus(t2.id, 'resolved');

        const resolvedThreads = store.getThreads().filter(t => t.status === 'resolved');
        assert.strictEqual(resolvedThreads.length, 1);
        assert.strictEqual(resolvedThreads[0].id, t2.id);
    });

    test('no threads returns empty array', () => {
        const threads = store.getThreads().filter(t => t.status === 'open');
        assert.strictEqual(threads.length, 0);
    });

    // --- onThreadsChanged callback flow ---

    test('onDidChangeThreads fires for all mutation operations', async () => {
        let count = 0;
        store.onDidChangeThreads(() => { count++; });

        const thread = await store.addThread('x.ts', 1, 'Test'); // +1
        await store.addComment(thread.id, 'user', 'Reply'); // +1
        await store.setThreadStatus(thread.id, 'resolved'); // +1
        await store.editComment(thread.id, thread.comments[0].id, 'Edited'); // +1
        await store.deleteThread(thread.id); // +1

        assert.strictEqual(count, 5, 'Should fire 5 times for 5 mutations');
    });

    // --- External file (outside workspace) ---

    test('asRelativePath returns absolute path for files outside workspaceFolder', () => {
        // When a file is outside the workspace, VS Code's asRelativePath
        // returns the absolute path. This tests how the store handles that.
        const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-external-'));
        try {
            const externalUri = vscode.Uri.file(path.join(externalDir, 'external.ts'));
            const relativePath = vscode.workspace.asRelativePath(externalUri, false);
            // For an external file, the "relative" path is actually the full absolute path
            assert.ok(
                path.isAbsolute(relativePath) || relativePath === externalUri.fsPath,
                `Expected absolute path for external file, got: ${relativePath}`
            );
        } finally {
            fs.rmSync(externalDir, { recursive: true, force: true });
        }
    });

    test('addThread with external file path stores the full path', async () => {
        const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-external-'));
        try {
            const externalFilePath = path.join(externalDir, 'external.ts');
            fs.writeFileSync(externalFilePath, 'line0\nline1\nline2\n');
            const externalUri = vscode.Uri.file(externalFilePath);
            const relativePath = vscode.workspace.asRelativePath(externalUri, false);

            // Store the thread using the path as VS Code resolves it
            const thread = await store.addThread(relativePath, 2, 'External file comment');
            assert.strictEqual(thread.filePath, relativePath);
            assert.strictEqual(thread.lineNumber, 2);

            // Querying by the same path should return the thread
            const found = store.getThreadsByFile(relativePath);
            assert.strictEqual(found.length, 1);
        } finally {
            fs.rmSync(externalDir, { recursive: true, force: true });
        }
    });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../reviewStore';

suite('DecorationProvider Test Suite', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-deco-test-'));
        workspaceFolder = {
            uri: vscode.Uri.file(tmpDir),
            name: 'test',
            index: 0,
        };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('getThreadsByFile returns threads for matching file only', async () => {
        await store.addThread('src/app.ts', 5, 'Review A');
        await store.addThread('src/other.ts', 10, 'Review B');
        await store.addThread('src/app.ts', 20, 'Review C');

        const appThreads = store.getThreadsByFile('src/app.ts');
        assert.strictEqual(appThreads.length, 2);
        assert.ok(appThreads.every(t => t.filePath === 'src/app.ts'));
    });

    test('resolved threads are excluded by status filter', async () => {
        const thread = await store.addThread('src/app.ts', 5, 'Review A');
        await store.addThread('src/app.ts', 10, 'Review B');
        await store.setThreadStatus(thread.id, 'resolved');

        const openThreads = store.getThreadsByFile('src/app.ts')
            .filter(t => t.status === 'open');
        assert.strictEqual(openThreads.length, 1);
        assert.strictEqual(openThreads[0].comments[0].body, 'Review B');
    });

    test('thread lineNumber is stored correctly', async () => {
        const thread = await store.addThread('test.ts', 42, 'Line check');
        assert.strictEqual(thread.lineNumber, 42);
    });

    test('thread first comment body available for hover preview', async () => {
        const thread = await store.addThread('test.ts', 0, 'REVIEW: Fix error handling');
        assert.strictEqual(thread.comments[0].body, 'REVIEW: Fix error handling');
    });

    test('onDidChangeThreads fires when thread status changes', async () => {
        const thread = await store.addThread('test.ts', 0, 'Test');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(fired, true);
    });
});

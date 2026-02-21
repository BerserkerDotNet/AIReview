import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../reviewStore';

suite('DocumentChangeTracker Test Suite', () => {
    let store: ReviewStore;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-tracker-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
    });

    teardown(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('adjustLineNumbers shifts threads below insertion point', async () => {
        const thread = await store.addThread('src/a.ts', 10, 'Was on line 10');
        // Insert 3 lines at line 5 → threads after line 5 shift down by 3
        await store.adjustLineNumbers('src/a.ts', 5, 3);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 13);
    });

    test('adjustLineNumbers shifts threads up on deletion', async () => {
        const thread = await store.addThread('src/a.ts', 10, 'Was on line 10');
        // Delete 2 lines at line 3 → threads after line 3 shift up by 2
        await store.adjustLineNumbers('src/a.ts', 3, -2);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 8);
    });

    test('adjustLineNumbers does not affect threads above the change', async () => {
        const thread = await store.addThread('src/a.ts', 2, 'Above change');
        await store.adjustLineNumbers('src/a.ts', 5, 3);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 2);
    });

    test('adjustLineNumbers clamps thread inside deleted range to change start', async () => {
        const thread = await store.addThread('src/a.ts', 7, 'Inside deleted range');
        // Delete lines 5–10 (delta = -5, start = 5)
        await store.adjustLineNumbers('src/a.ts', 5, -5);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 5);
    });

    test('adjustLineNumbers does nothing for delta = 0', async () => {
        const thread = await store.addThread('src/a.ts', 5, 'Unchanged');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.adjustLineNumbers('src/a.ts', 0, 0);
        assert.strictEqual(fired, false);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 5);
    });

    test('adjustLineNumbers does not affect threads in other files', async () => {
        const thread = await store.addThread('src/b.ts', 10, 'Other file');
        await store.adjustLineNumbers('src/a.ts', 0, 5);
        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 10);
    });
});

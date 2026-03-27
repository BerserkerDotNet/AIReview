import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import { DocumentChangeTracker } from '../../documentChangeTracker';

suite('DocumentChangeTracker — Integration Tests', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tracker: DocumentChangeTracker;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-tracker-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
        tracker = new DocumentChangeTracker(store);
    });

    teardown(() => {
        tracker.dispose();
        persistence.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Helper: create a file, open it, and return the editor + relative path
    async function openTrackedFile(name: string, lineCount: number) {
        const filePath = path.join(tmpDir, name);
        const lines = Array.from({ length: lineCount }, (_, i) => `line${i}`).join('\n') + '\n';
        fs.writeFileSync(filePath, lines);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        return { editor, relativePath };
    }

    // Wait for the tracker's 500ms debounce + margin
    function waitForDebounce(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 800));
    }

    test('inserting lines above a thread shifts it down', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openTrackedFile('insert.ts', 10);
        const thread = await store.addThread(relativePath, 6, 'Thread at line 5');

        await editor.edit(eb => {
            eb.insert(new vscode.Position(2, 0), 'new1\nnew2\n');
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 8); // 5 + 2
    });

    test('deleting lines above a thread shifts it up', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openTrackedFile('delete.ts', 10);
        const thread = await store.addThread(relativePath, 9, 'Thread at line 8');

        await editor.edit(eb => {
            eb.delete(new vscode.Range(2, 0, 5, 0)); // delete 3 lines
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 6); // 8 - 3
    });

    test('editing below a thread does not move it', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openTrackedFile('below.ts', 10);
        const thread = await store.addThread(relativePath, 3, 'Thread at line 2');

        await editor.edit(eb => {
            eb.insert(new vscode.Position(5, 0), 'extra\n');
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 3); // unchanged
    });

    test('changes in a different file do not affect threads', async function () {
        this.timeout(5000);
        // Thread is in 'other.ts' (not opened / not edited)
        await store.addThread('other.ts', 6, 'Other file thread');

        const { editor } = await openTrackedFile('unrelated.ts', 10);
        await editor.edit(eb => {
            eb.insert(new vscode.Position(0, 0), 'added\n');
        });
        await waitForDebounce();

        assert.strictEqual(store.getThreads()[0].lineNumber, 6); // unchanged
    });

    test('multiple threads in the same file all shift correctly', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openTrackedFile('multi.ts', 20);
        const t1 = await store.addThread(relativePath, 4, 'Low');
        const t2 = await store.addThread(relativePath, 11, 'Mid');
        const t3 = await store.addThread(relativePath, 16, 'High');

        // Insert 4 lines at line 5
        await editor.edit(eb => {
            eb.insert(new vscode.Position(5, 0), 'a\nb\nc\nd\n');
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(t1.id)!.lineNumber, 4);  // below change start, unchanged
        assert.strictEqual(store.getThread(t2.id)!.lineNumber, 15); // 10 + 4
        assert.strictEqual(store.getThread(t3.id)!.lineNumber, 20); // 15 + 4
    });

    test('dispose cleans up pending timers without errors', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openTrackedFile('dispose.ts', 10);
        await store.addThread(relativePath, 6, 'Timer test');

        // Make an edit but dispose before debounce fires
        await editor.edit(eb => {
            eb.insert(new vscode.Position(0, 0), 'rush\n');
        });
        // Dispose immediately — should not throw
        tracker.dispose();

        // Re-create for teardown
        tracker = new DocumentChangeTracker(store);
    });
});

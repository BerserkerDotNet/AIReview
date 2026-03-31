import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import { DocumentChangeTracker } from '../../documentChangeTracker';

suite('DocumentChangeTracker — Edge Case Integration Tests', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tracker: DocumentChangeTracker;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-dct-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
        tracker = new DocumentChangeTracker(store);
    });

    teardown(async () => {
        tracker.dispose();
        persistence.dispose();
        store.dispose();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* CI file lock */ }
    });

    async function openFile(name: string, lineCount: number) {
        const filePath = path.join(tmpDir, name);
        const lines = Array.from({ length: lineCount }, (_, i) => `line${i}`).join('\n') + '\n';
        fs.writeFileSync(filePath, lines);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        return { editor, relativePath };
    }

    function waitForDebounce(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 800));
    }

    test('dispose cleans up pending timers without errors', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openFile('timer.ts', 10);
        await store.addThread(relativePath, 6, 'Timer test');

        // Make an edit but dispose before debounce fires
        await editor.edit(eb => {
            eb.insert(new vscode.Position(0, 0), 'rush\n');
        });
        // Dispose immediately — should not throw
        tracker.dispose();
        tracker = new DocumentChangeTracker(store);
    });

    test('tracker ignores changes in files with no threads', async function () {
        this.timeout(5000);
        // Thread exists only in 'other.ts' (not opened/edited)
        await store.addThread('other.ts', 6, 'Other file');

        // Edit a file that has no threads
        const { editor } = await openFile('untracked.ts', 5);
        await editor.edit(eb => {
            eb.insert(new vscode.Position(0, 0), 'new line\n');
        });
        await waitForDebounce();

        // Thread in 'other.ts' must be completely unaffected
        assert.strictEqual(store.getThreads()[0].lineNumber, 6);
    });

    test('deletion that engulfs a thread clamps it to the change start', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openFile('engulf.ts', 20);
        const t1 = await store.addThread(relativePath, 4, 'Above');
        const t2 = await store.addThread(relativePath, 8, 'Inside deleted range');
        const t3 = await store.addThread(relativePath, 16, 'Below');

        // Delete lines 5-11 (7 lines)
        await editor.edit(eb => {
            eb.delete(new vscode.Range(5, 0, 12, 0));
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(t1.id)!.lineNumber, 4); // unaffected
        assert.strictEqual(store.getThread(t2.id)!.lineNumber, 6); // clamped to change start
        assert.strictEqual(store.getThread(t3.id)!.lineNumber, 9); // 15 - 7
    });

    test('edit at exact thread line does not move thread', async function () {
        this.timeout(5000);
        const { editor, relativePath } = await openFile('exact.ts', 10);
        const thread = await store.addThread(relativePath, 6, 'On this line');

        // Replace text on the same line (no line count change)
        await editor.edit(eb => {
            eb.replace(new vscode.Range(5, 0, 5, 5), 'replaced');
        });
        await waitForDebounce();

        assert.strictEqual(store.getThread(thread.id)!.lineNumber, 6);
    });
});

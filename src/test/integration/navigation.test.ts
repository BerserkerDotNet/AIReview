import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import { findNextThread, findPreviousThread } from '../../threadNavigation';

suite('Navigation Commands Integration Tests', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    async function createTestFile(name: string, lineCount: number): Promise<string> {
        const filePath = path.join(tmpDir, name);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        const content = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
        fs.writeFileSync(filePath, content);
        return filePath;
    }

    function getCursorLine(): number {
        return vscode.window.activeTextEditor!.selection.active.line;
    }

    async function openFileAtLine(filePath: string, lineZeroIndexed: number): Promise<vscode.TextEditor> {
        const uri = vscode.Uri.file(filePath);
        return vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(lineZeroIndexed, 0, lineZeroIndexed, 0),
        });
    }

    /** Simulates what navigateToThread does, but resolves paths against tmpDir instead of workspace root. */
    async function navigateToThread(relPath: string, lineNumber: number): Promise<vscode.TextEditor> {
        const absPath = path.join(tmpDir, relPath);
        const line = lineNumber - 1; // 1-indexed → 0-indexed
        const uri = vscode.Uri.file(absPath);
        return vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(line, 0, line, 0),
        });
    }

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-nav-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        // Allow VS Code to release file handles after closing editors
        await new Promise(resolve => setTimeout(resolve, 200));
        persistence.dispose();
        store.dispose();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        } catch {
            // Ignore cleanup errors — OS may still hold file locks
        }
    });

    // --- Test 1: nextThread navigates to correct line ---

    test('nextThread navigates to correct line', async () => {
        const filePath = await createTestFile('test.ts', 20);
        await store.addThread('test.ts', 10, 'REVIEW: Check this');

        // Open file at line 1 (0-indexed = 0)
        await openFileAtLine(filePath, 0);
        assert.strictEqual(getCursorLine(), 0);

        // Find next open thread from current position (line 1, 1-indexed)
        const openThreads = store.getThreads().filter(t => t.status === 'open');
        const target = findNextThread(openThreads, 'test.ts', 1);
        assert.ok(target, 'Should find a target thread');
        assert.strictEqual(target!.lineNumber, 10);

        // Navigate and verify cursor moves to line 10 (0-indexed = 9)
        await navigateToThread(target!.filePath, target!.lineNumber);
        assert.strictEqual(getCursorLine(), 9);
    });

    // --- Test 2: nextThread wraps within file ---

    test('nextThread wraps within file', async () => {
        const filePath = await createTestFile('wrap.ts', 20);
        await store.addThread('wrap.ts', 5, 'Thread at 5');
        await store.addThread('wrap.ts', 15, 'Thread at 15');

        // Position cursor at line 16 (0-indexed = 15), past both threads
        await openFileAtLine(filePath, 15);
        assert.strictEqual(getCursorLine(), 15);

        // findNextThread: no thread with lineNumber > 16, wraps to first thread (line 5)
        const openThreads = store.getThreads().filter(t => t.status === 'open');
        const target = findNextThread(openThreads, 'wrap.ts', 16);
        assert.ok(target, 'Should wrap to first thread');
        assert.strictEqual(target!.lineNumber, 5);

        await navigateToThread(target!.filePath, target!.lineNumber);
        assert.strictEqual(getCursorLine(), 4); // line 5, 0-indexed
    });

    // --- Test 3: previousThread navigates backward ---

    test('previousThread navigates backward', async () => {
        const filePath = await createTestFile('prev.ts', 20);
        await store.addThread('prev.ts', 5, 'Thread at 5');
        await store.addThread('prev.ts', 15, 'Thread at 15');

        // Position cursor at line 16 (0-indexed = 15)
        await openFileAtLine(filePath, 15);

        // findPreviousThread: finds thread at line 15 (lineNumber < 16)
        const openThreads = store.getThreads().filter(t => t.status === 'open');
        const target = findPreviousThread(openThreads, 'prev.ts', 16);
        assert.ok(target, 'Should find previous thread');
        assert.strictEqual(target!.lineNumber, 15);

        await navigateToThread(target!.filePath, target!.lineNumber);
        assert.strictEqual(getCursorLine(), 14); // line 15, 0-indexed
    });

    // --- Test 4: nextThread with no threads shows message (no crash) ---

    test('nextThread with no threads does not crash', async () => {
        assert.strictEqual(store.getThreads().length, 0);

        // Execute the actual registered command — uses the extension's internal store.
        // At minimum verifies the command exists and handles empty state gracefully.
        await vscode.commands.executeCommand('ai-review.nextThread');
    });

    // --- Test 5: navigation across files ---

    test('navigation across files', async () => {
        const fileAPath = await createTestFile('aaa.ts', 20);
        await createTestFile('bbb.ts', 20);

        await store.addThread('aaa.ts', 8, 'Thread in A');
        await store.addThread('bbb.ts', 12, 'Thread in B');

        // Open file A with cursor ON the thread at line 8.
        // When the cursor is on the only thread in the current file,
        // findNextThread skips the within-file wrap and crosses to the next file.
        await openFileAtLine(fileAPath, 7); // line 8, 0-indexed = 7
        assert.strictEqual(getCursorLine(), 7);

        const openThreads = store.getThreads().filter(t => t.status === 'open');
        const target = findNextThread(openThreads, 'aaa.ts', 8);
        assert.ok(target, 'Should cross to file B');
        assert.strictEqual(target!.filePath, 'bbb.ts');
        assert.strictEqual(target!.lineNumber, 12);

        // Navigate to file B
        await navigateToThread(target!.filePath, target!.lineNumber);
        assert.strictEqual(getCursorLine(), 11); // line 12, 0-indexed
        assert.ok(
            vscode.window.activeTextEditor!.document.uri.fsPath.endsWith('bbb.ts'),
            `Expected bbb.ts but got ${vscode.window.activeTextEditor!.document.uri.fsPath}`,
        );
    });
});

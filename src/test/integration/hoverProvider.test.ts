import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import { ReviewHoverProvider } from '../../hoverProvider';

suite('ReviewHoverProvider Test Suite', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let hoverProvider: ReviewHoverProvider;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-hover-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
        hoverProvider = new ReviewHoverProvider(store);
    });

    teardown(() => {
        hoverProvider.dispose();
        persistence.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('provideHover returns hover with "Add Review Comment" when no threads on line', async () => {
        // Create a real file so we can get a TextDocument
        const filePath = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(filePath, 'line 0\nline 1\nline 2\n');
        const doc = await vscode.workspace.openTextDocument(filePath);
        const position = new vscode.Position(1, 0);

        const hover = hoverProvider.provideHover(doc, position);
        assert.ok(hover, 'Hover should be returned');
        const md = hover!.contents[0] as vscode.MarkdownString;
        assert.ok(md.value.includes('Add Review Comment'), 'Should show add comment link');
    });

    test('provideHover shows thread preview when thread exists on line', async () => {
        const filePath = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(filePath, 'line 0\nline 1\nline 2\n');
        const doc = await vscode.workspace.openTextDocument(filePath);
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

        await store.addThread(relativePath, 2, 'REVIEW: Fix this bug');
        const position = new vscode.Position(1, 0);

        const hover = hoverProvider.provideHover(doc, position);
        assert.ok(hover);
        const md = hover!.contents[0] as vscode.MarkdownString;
        assert.ok(md.value.includes('Review thread'), 'Should show thread header');
        assert.ok(md.value.includes('REVIEW: Fix this bug'), 'Should show comment preview');
        assert.ok(md.value.includes('Add reply'), 'Should show reply link');
        assert.ok(md.value.includes('Resolve'), 'Should show resolve link');
    });

    test('provideHover ignores resolved threads', async () => {
        const filePath = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(filePath, 'line 0\nline 1\n');
        const doc = await vscode.workspace.openTextDocument(filePath);
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

        const thread = await store.addThread(relativePath, 2, 'Resolved thread');
        await store.setThreadStatus(thread.id, 'resolved');
        const position = new vscode.Position(1, 0);

        const hover = hoverProvider.provideHover(doc, position);
        assert.ok(hover);
        const md = hover!.contents[0] as vscode.MarkdownString;
        assert.ok(md.value.includes('Add Review Comment'), 'Should show add comment (resolved thread ignored)');
        assert.ok(!md.value.includes('Review thread'), 'Should NOT show thread header');
    });

    test('provideHover on line without thread shows add comment', async () => {
        const filePath = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(filePath, 'line 0\nline 1\nline 2\n');
        const doc = await vscode.workspace.openTextDocument(filePath);
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

        await store.addThread(relativePath, 1, 'Thread on line 0');
        const position = new vscode.Position(2, 0); // No thread here

        const hover = hoverProvider.provideHover(doc, position);
        assert.ok(hover);
        const md = hover!.contents[0] as vscode.MarkdownString;
        assert.ok(md.value.includes('Add Review Comment'));
    });

    test('dispose cleans up without errors', () => {
        hoverProvider.dispose();
        // Re-create for teardown
        hoverProvider = new ReviewHoverProvider(store);
    });
});

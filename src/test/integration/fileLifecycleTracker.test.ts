import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { FileLifecycleTracker } from '../../fileLifecycleTracker';

suite('FileLifecycleTracker Test Suite', () => {
    let store: ReviewStore;
    let tracker: FileLifecycleTracker;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-flt-test-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        store = new ReviewStore();
        await store.initialize(workspaceFolder);
        tracker = new FileLifecycleTracker(store);
    });

    teardown(() => {
        tracker.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Test the store methods that FileLifecycleTracker calls

    test('remapThreadsForRename handles exact file rename', async () => {
        const thread = await store.addThread('src/old.ts', 6, 'Rename me');
        const changed = await store.remapThreadsForRename('src/old.ts', 'src/new.ts');
        assert.strictEqual(changed, 1);
        assert.strictEqual(store.getThread(thread.id)!.filePath, 'src/new.ts');
    });

    test('remapThreadsForRename handles folder rename with nested files', async () => {
        const t1 = await store.addThread('src/old/a.ts', 2, 'A');
        const t2 = await store.addThread('src/old/sub/b.ts', 3, 'B');
        const t3 = await store.addThread('src/other/c.ts', 4, 'C');
        
        const changed = await store.remapThreadsForRename('src/old', 'src/new');
        assert.strictEqual(changed, 2);
        assert.ok(store.getThread(t1.id)!.filePath.startsWith('src'));
        assert.ok(store.getThread(t3.id)!.filePath === 'src/other/c.ts'); // unchanged
    });

    test('remapThreadsForRename is case-insensitive on match', async () => {
        await store.addThread('SRC/App.ts', 2, 'Mixed case');
        const changed = await store.remapThreadsForRename('src/app.ts', 'src/renamed.ts');
        assert.strictEqual(changed, 1);
    });

    test('removeThreadsForDeletedPath removes exact file threads', async () => {
        await store.addThread('src/delete-me.ts', 2, 'Delete');
        await store.addThread('src/keep.ts', 3, 'Keep');
        const removed = await store.removeThreadsForDeletedPath('src/delete-me.ts');
        assert.strictEqual(removed, 1);
        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'src/keep.ts');
    });

    test('removeThreadsForDeletedPath removes folder contents', async () => {
        await store.addThread('src/folder/a.ts', 2, 'A');
        await store.addThread('src/folder/sub/b.ts', 3, 'B');
        await store.addThread('src/other.ts', 4, 'Other');
        const removed = await store.removeThreadsForDeletedPath('src/folder');
        assert.strictEqual(removed, 2);
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('removeThreadsForDeletedPath fires onDidChangeThreads', async () => {
        await store.addThread('src/gone.ts', 2, 'Gone');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.removeThreadsForDeletedPath('src/gone.ts');
        assert.strictEqual(fired, true);
    });

    test('removeThreadsForDeletedPath does not fire when no threads match', async () => {
        await store.addThread('src/keep.ts', 2, 'Keep');
        let fired = false;
        store.onDidChangeThreads(() => { fired = true; });
        await store.removeThreadsForDeletedPath('src/nonexistent.ts');
        assert.strictEqual(fired, false);
    });

    test('tracker dispose cleans up without errors', () => {
        tracker.dispose();
        tracker = new FileLifecycleTracker(store);
    });
});

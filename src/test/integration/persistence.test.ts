import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';
import type { IReviewStorePersistence } from '../../reviewStorePersistence';
import type { ReviewData } from '../../models';

suite('Persistence Edge Cases', () => {
    let store: ReviewStore;
    let persistence: ReviewStorePersistence;
    let tmpDir: string;
    let workspaceFolder: vscode.WorkspaceFolder;
    let storeFilePath: string;

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-persist-'));
        workspaceFolder = { uri: vscode.Uri.file(tmpDir), name: 'test', index: 0 };
        storeFilePath = path.join(tmpDir, '.vscode', '.ai-review.json');
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    teardown(async () => {
        // Reset autoSave config in case a test changed it
        await vscode.workspace.getConfiguration('aiReview')
            .update('autoSave', undefined, vscode.ConfigurationTarget.Global);
        persistence.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('graceful recovery from malformed JSON', async () => {
        // Write invalid JSON to the store file
        await store.addThread('x.ts', 1, 'Before corruption');
        persistence.dispose();
        store.dispose();

        fs.writeFileSync(storeFilePath, '{ invalid json !!!', 'utf-8');

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);
        // Should recover with empty data, not throw
        assert.strictEqual(store2.getThreads().length, 0);
        persistence2.dispose();
        store2.dispose();

        // Re-create for teardown
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('graceful recovery from empty file', async () => {
        persistence.dispose();
        store.dispose();
        fs.writeFileSync(storeFilePath, '', 'utf-8');

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);
        assert.strictEqual(store2.getThreads().length, 0);
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('graceful recovery from missing version field', async () => {
        persistence.dispose();
        store.dispose();
        fs.writeFileSync(storeFilePath, JSON.stringify({ threads: [] }), 'utf-8');

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);
        // Missing version → parsed.version is falsy → falls through to default
        assert.strictEqual(store2.getThreads().length, 0);
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('graceful recovery from missing threads array', async () => {
        persistence.dispose();
        store.dispose();
        fs.writeFileSync(storeFilePath, JSON.stringify({ version: 1 }), 'utf-8');

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);
        // Missing threads array → Array.isArray check fails → default data
        assert.strictEqual(store2.getThreads().length, 0);
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('handles store file deleted while running', async () => {
        await store.addThread('x.ts', 1, 'Existing thread');
        assert.strictEqual(store.getThreads().length, 1);

        // Delete the file externally
        fs.unlinkSync(storeFilePath);

        // Re-initialize — simulates what happens when the extension reloads
        // after an external deletion. This is more reliable than depending on
        // file watcher timing which is non-deterministic in CI.
        persistence.dispose();
        persistence = new ReviewStorePersistence();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);

        // Store should start fresh since the file was deleted
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('initializing without existing store file creates empty store', async () => {
        persistence.dispose();
        store.dispose();
        // Remove the .vscode directory entirely
        fs.rmSync(path.join(tmpDir, '.vscode'), { recursive: true, force: true });

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);
        assert.strictEqual(store2.getThreads().length, 0);

        // Should be able to add threads (creates directory and file)
        await store2.addThread('x.ts', 0, 'Fresh start');
        assert.strictEqual(store2.getThreads().length, 1);
        assert.ok(fs.existsSync(storeFilePath));
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('JSON format is human-readable (pretty-printed)', async () => {
        await store.addThread('x.ts', 1, 'Pretty print test');
        const content = fs.readFileSync(storeFilePath, 'utf-8');
        // Should be pretty-printed with indentation
        assert.ok(content.includes('\n'), 'JSON should be multi-line');
        assert.ok(content.includes('  '), 'JSON should be indented');
    });

    test('store file contains expected structure', async () => {
        await store.addThread('src/app.ts', 43, 'Structure test');
        const content = JSON.parse(fs.readFileSync(storeFilePath, 'utf-8'));
        assert.strictEqual(content.version, 1);
        assert.ok(Array.isArray(content.threads));
        assert.strictEqual(content.threads.length, 1);
        assert.strictEqual(content.threads[0].filePath, 'src/app.ts');
        assert.strictEqual(content.threads[0].lineNumber, 43);
        assert.strictEqual(content.threads[0].status, 'open');
        assert.ok(content.threads[0].id);
        assert.ok(content.threads[0].createdAt);
        assert.ok(Array.isArray(content.threads[0].comments));
        assert.strictEqual(content.threads[0].comments[0].body, 'Structure test');
        assert.strictEqual(content.threads[0].comments[0].author, 'user');
    });

    test('multiple threads persist correctly', async () => {
        await store.addThread('a.ts', 2, 'Thread A');
        await store.addThread('b.ts', 3, 'Thread B');
        await store.addThread('c.ts', 4, 'Thread C');

        persistence.dispose();
        store.dispose();
        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);

        assert.strictEqual(store2.getThreads().length, 3);
        const bodies = store2.getThreads().map(t => t.comments[0].body).sort();
        assert.deepStrictEqual(bodies, ['Thread A', 'Thread B', 'Thread C']);
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('thread with many comments persists all of them', async () => {
        const thread = await store.addThread('x.ts', 1, 'Comment 1');
        for (let i = 2; i <= 10; i++) {
            await store.addComment(thread.id, i % 2 === 0 ? 'llm' : 'user', `Comment ${i}`);
        }

        persistence.dispose();
        store.dispose();
        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);

        const reloaded = store2.getThread(thread.id)!;
        assert.strictEqual(reloaded.comments.length, 10);
        for (let i = 0; i < 10; i++) {
            assert.strictEqual(reloaded.comments[i].body, `Comment ${i + 1}`);
        }
        persistence2.dispose();
        store2.dispose();

        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });

    test('autoSave=false prevents disk writes', async () => {
        const config = vscode.workspace.getConfiguration('aiReview');

        // Add a thread with autoSave enabled (default) to establish baseline on disk
        await store.addThread('x.ts', 1, 'Persisted thread');
        assert.ok(fs.existsSync(storeFilePath), 'File should exist after first save');
        const contentBefore = fs.readFileSync(storeFilePath, 'utf-8');

        // Disable autoSave
        await config.update('autoSave', false, vscode.ConfigurationTarget.Global);
        try {
            await store.addThread('y.ts', 2, 'Should not persist');

            // In-memory store should have both threads
            assert.strictEqual(store.getThreads().length, 2);

            // File should still have only the first thread
            const contentAfter = fs.readFileSync(storeFilePath, 'utf-8');
            assert.strictEqual(contentAfter, contentBefore,
                'File content should not change when autoSave is false');
            const parsed = JSON.parse(contentAfter);
            assert.strictEqual(parsed.threads.length, 1,
                'Only the persisted thread should be on disk');
        } finally {
            await config.update('autoSave', undefined, vscode.ConfigurationTarget.Global);
        }
    });

    test('rapid sequential saves do not corrupt', async () => {
        for (let i = 0; i < 5; i++) {
            await store.addThread(`file${i}.ts`, i + 1, `Rapid ${i}`);
        }
        assert.strictEqual(store.getThreads().length, 5);

        const raw = fs.readFileSync(storeFilePath, 'utf-8');
        const parsed = JSON.parse(raw); // Should not throw — valid JSON
        assert.strictEqual(parsed.threads.length, 5);
        for (let i = 0; i < 5; i++) {
            assert.ok(
                parsed.threads.find((t: any) => t.comments[0].body === `Rapid ${i}`),
                `Rapid ${i} should be in persisted JSON`
            );
        }
    });

    test('store state survives persistence failure', async () => {
        const emitter = new vscode.EventEmitter<ReviewData>();
        const failingPersistence: IReviewStorePersistence = {
            initialize: async () => ({ version: 1, threads: [] }),
            save: async () => { throw new Error('Simulated write failure'); },
            onExternalChange: emitter.event,
            dispose: () => { emitter.dispose(); },
        };

        const failStore = new ReviewStore();
        failStore.setPersistence(failingPersistence);
        failStore.loadData({ version: 1, threads: [] });

        // addThread mutates in-memory data BEFORE calling save,
        // so the thread should be present even though save throws.
        try {
            await failStore.addThread('x.ts', 1, 'Survives failure');
        } catch {
            // Expected — save throws
        }

        const threads = failStore.getThreads();
        assert.strictEqual(threads.length, 1, 'Thread should be in memory despite save failure');
        assert.strictEqual(threads[0].comments[0].body, 'Survives failure');

        failStore.dispose();
        failingPersistence.dispose();
    });

    test('isOwnWrite suppresses reload during save', async () => {
        let externalChangeCount = 0;
        const disposable = persistence.onExternalChange(() => {
            externalChangeCount++;
        });

        await store.addThread('x.ts', 1, 'Trigger save');

        // Give the file watcher time to fire (if it would)
        await new Promise(resolve => setTimeout(resolve, 1500));

        assert.strictEqual(externalChangeCount, 0,
            'onExternalChange should not fire for own writes');
        disposable.dispose();
    });

    test('large thread count persists correctly', async () => {
        for (let i = 0; i < 100; i++) {
            await store.addThread(`file${i}.ts`, i + 1, `Thread ${i}`);
        }
        assert.strictEqual(store.getThreads().length, 100);

        persistence.dispose();
        store.dispose();

        const persistence2 = new ReviewStorePersistence();
        const store2 = new ReviewStore();
        store2.setPersistence(persistence2);
        const data2 = await persistence2.initialize(workspaceFolder);
        store2.loadData(data2);

        assert.strictEqual(store2.getThreads().length, 100);
        for (let i = 0; i < 100; i++) {
            const found = store2.getThreads().find(t => t.comments[0].body === `Thread ${i}`);
            assert.ok(found, `Thread ${i} should exist after reload`);
        }

        persistence2.dispose();
        store2.dispose();

        // Re-create for teardown
        persistence = new ReviewStorePersistence();
        store = new ReviewStore();
        store.setPersistence(persistence);
        const data = await persistence.initialize(workspaceFolder);
        store.loadData(data);
    });
});

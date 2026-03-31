import * as assert from 'assert';
import { ReviewStore } from '../../reviewStore';
import type { ThreadChangeEvent } from '../../changeEvent';

suite('ReviewStore — Pure Unit Tests', () => {
    let store: ReviewStore;

    setup(() => {
        store = new ReviewStore();
    });

    teardown(() => {
        store.dispose();
    });

    test('starts with no threads', () => {
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('addThread creates a thread', async () => {
        const thread = await store.addThread('src/app.ts', 11, 'REVIEW: Fix this');
        assert.strictEqual(thread.filePath, 'src/app.ts');
        assert.strictEqual(thread.lineNumber, 11);
        assert.strictEqual(thread.comments.length, 1);
        assert.strictEqual(thread.comments[0].author, 'user');
    });

    test('addComment appends to thread', async () => {
        const thread = await store.addThread('x.ts', 1, 'First');
        const comment = await store.addComment(thread.id, 'llm', 'Reply');
        assert.ok(comment);
        assert.strictEqual(store.getThread(thread.id)!.comments.length, 2);
    });

    test('addComment returns undefined for unknown thread', async () => {
        const result = await store.addComment('bad-id', 'user', 'nope');
        assert.strictEqual(result, undefined);
    });

    test('editComment updates body and sets editedAt', async () => {
        const thread = await store.addThread('x.ts', 1, 'Original');
        const cid = thread.comments[0].id;
        const ok = await store.editComment(thread.id, cid, 'Updated');
        assert.strictEqual(ok, true);
        assert.strictEqual(store.getThread(thread.id)!.comments[0].body, 'Updated');
        assert.ok(store.getThread(thread.id)!.comments[0].editedAt);
    });

    test('editComment returns false for unknown thread/comment', async () => {
        assert.strictEqual(await store.editComment('bad', 'bad', 'x'), false);
        const thread = await store.addThread('x.ts', 1, 'Y');
        assert.strictEqual(await store.editComment(thread.id, 'bad', 'x'), false);
    });

    test('setThreadStatus changes status', async () => {
        const thread = await store.addThread('x.ts', 1, 'Test');
        await store.setThreadStatus(thread.id, 'resolved');
        assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
    });

    test('deleteThread removes thread', async () => {
        const thread = await store.addThread('x.ts', 1, 'Delete me');
        await store.deleteThread(thread.id);
        assert.strictEqual(store.getThreads().length, 0);
    });

    test('getThreadsByFile filters correctly', async () => {
        await store.addThread('a.ts', 1, 'A');
        await store.addThread('b.ts', 2, 'B');
        await store.addThread('a.ts', 3, 'A2');
        assert.strictEqual(store.getThreadsByFile('a.ts').length, 2);
    });

    test('getOpenThreadsByFile excludes resolved', async () => {
        const t = await store.addThread('a.ts', 1, 'Open');
        await store.addThread('a.ts', 2, 'Also open');
        await store.setThreadStatus(t.id, 'resolved');
        assert.strictEqual(store.getOpenThreadsByFile('a.ts').length, 1);
    });

    test('getThreadByFileAndLine finds exact match', async () => {
        await store.addThread('a.ts', 5, 'Here');
        const found = store.getThreadByFileAndLine('a.ts', 5);
        assert.ok(found);
        assert.strictEqual(found!.lineNumber, 5);
    });

    test('adjustLineNumbers shifts threads below change', async () => {
        const t = await store.addThread('a.ts', 11, 'Below');
        await store.adjustLineNumbers('a.ts', 6, 3);
        assert.strictEqual(store.getThread(t.id)!.lineNumber, 14);
    });

    test('adjustLineNumbers clamps deleted range', async () => {
        const t = await store.addThread('a.ts', 8, 'Inside');
        await store.adjustLineNumbers('a.ts', 6, -5);
        assert.strictEqual(store.getThread(t.id)!.lineNumber, 6);
    });

    test('onDidChangeThreads fires on mutations', async () => {
        let count = 0;
        store.onDidChangeThreads(() => { count++; });
        const t = await store.addThread('x.ts', 1, 'Test');
        await store.addComment(t.id, 'user', 'Reply');
        await store.setThreadStatus(t.id, 'resolved');
        await store.deleteThread(t.id);
        assert.strictEqual(count, 4);
    });

    test('remapThreadsForRename updates paths', async () => {
        await store.addThread('src/old.ts', 1, 'Rename');
        const changed = await store.remapThreadsForRename('src/old.ts', 'src/new.ts');
        assert.strictEqual(changed, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'src/new.ts');
    });

    test('removeThreadsForDeletedPath removes matching threads', async () => {
        await store.addThread('src/gone.ts', 1, 'Gone');
        await store.addThread('src/keep.ts', 1, 'Keep');
        const removed = await store.removeThreadsForDeletedPath('src/gone.ts');
        assert.strictEqual(removed, 1);
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('works without persistence (no-op save)', async () => {
        // No setPersistence called — save should silently no-op
        const thread = await store.addThread('x.ts', 1, 'No persistence');
        assert.ok(thread);
        assert.strictEqual(store.getThreads().length, 1);
    });

    // --- Edge-case tests ---

    test('loadData with missing version does NOT overwrite existing data', async () => {
        await store.addThread('keep.ts', 1, 'Keep me');
        store.loadData({ threads: [] } as any);
        assert.strictEqual(store.getThreads().length, 1);
        assert.strictEqual(store.getThreads()[0].filePath, 'keep.ts');
    });

    test('loadData with non-array threads does NOT overwrite existing data', async () => {
        await store.addThread('keep.ts', 1, 'Keep me');
        store.loadData({ version: 1, threads: 'bad' } as any);
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('loadData fires onDidChangeThreads with reload event', () => {
        const events: ThreadChangeEvent[] = [];
        store.onDidChangeThreads(e => { events.push(e); });
        store.loadData({ version: 1, threads: [] });
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'reload');
    });

    test('getThreadsByFile after addThread uses file index', async () => {
        await store.addThread('a.ts', 10, 'Indexed');
        const results = store.getThreadsByFile('a.ts');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].filePath, 'a.ts');
        assert.strictEqual(store.getThreadsByFile('nonexistent.ts').length, 0);
    });

    test('file index rebuilt after remapThreadsForRename', async () => {
        await store.addThread('old.ts', 1, 'Move me');
        await store.remapThreadsForRename('old.ts', 'new.ts');
        assert.strictEqual(store.getThreadsByFile('new.ts').length, 1);
        assert.strictEqual(store.getThreadsByFile('old.ts').length, 0);
    });

    test('clearResolvedThreads with no resolved returns 0 and no event', async () => {
        await store.addThread('x.ts', 1, 'Open thread');
        let eventCount = 0;
        store.onDidChangeThreads(() => { eventCount++; });
        const removed = await store.clearResolvedThreads();
        assert.strictEqual(removed, 0);
        assert.strictEqual(eventCount, 0);
        assert.strictEqual(store.getThreads().length, 1);
    });

    test('deleteThread twice returns false second time', async () => {
        const thread = await store.addThread('x.ts', 1, 'Delete me');
        const first = await store.deleteThread(thread.id);
        const second = await store.deleteThread(thread.id);
        assert.strictEqual(first, true);
        assert.strictEqual(second, false);
    });

    test('addComment with empty body still succeeds', async () => {
        const thread = await store.addThread('x.ts', 1, 'Thread');
        const comment = await store.addComment(thread.id, 'llm', '');
        assert.ok(comment);
        assert.strictEqual(comment!.body, '');
        assert.strictEqual(store.getThread(thread.id)!.comments.length, 2);
    });
});

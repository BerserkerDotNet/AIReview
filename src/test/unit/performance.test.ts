import * as assert from 'assert';
import { ReviewStore } from '../../reviewStore';
import { createThread } from '../helpers/fixtures';

suite('Performance — Regression Tests', () => {
    let store: ReviewStore;

    setup(() => {
        store = new ReviewStore();
        const threads = [];
        for (let i = 0; i < 1000; i++) {
            threads.push(createThread({
                filePath: `src/file${i % 50}.ts`,
                lineNumber: (i % 200) + 1,
            }));
        }
        store.loadData({ version: 1, threads });
    });

    teardown(() => { store.dispose(); });

    test('getThreadsByFile completes in < 50ms for 1000 threads across 50 files', () => {
        const start = performance.now();
        for (let i = 0; i < 50; i++) {
            store.getThreadsByFile(`src/file${i}.ts`);
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
    });

    test('getOpenThreadsByFile completes in < 50ms', () => {
        const start = performance.now();
        for (let i = 0; i < 50; i++) {
            store.getOpenThreadsByFile(`src/file${i}.ts`);
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
    });

    test('adjustLineNumbers completes in < 50ms', async () => {
        const start = performance.now();
        await store.adjustLineNumbers('src/file0.ts', 5, 3);
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
    });

    test('getThreadByFileAndLine completes in < 20ms for 100 lookups', () => {
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            store.getThreadByFileAndLine(`src/file${i % 50}.ts`, (i % 200) + 1);
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 20, `Expected < 20ms, got ${elapsed.toFixed(2)}ms`);
    });

    test('addThread completes in < 50ms per insertion with 1000 existing threads', async () => {
        const start = performance.now();
        await store.addThread('src/newfile.ts', 10, 'perf test comment');
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
    });

    test('deleteThread completes in < 50ms with 1000 threads', async () => {
        const threadId = store.getThreads()[0].id;
        const start = performance.now();
        await store.deleteThread(threadId);
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
    });
});

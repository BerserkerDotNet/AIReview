import * as assert from 'assert';
import { ReviewStore } from '../../reviewStore';
import { ReviewHoverProvider } from '../../hoverProvider';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockVscode = require('vscode') as any;

suite('ReviewHoverProvider - provideHover', () => {
    let store: ReviewStore;
    let provider: ReviewHoverProvider;

    const mockDoc = { uri: mockVscode.Uri.file('/test/src/app.ts') } as any;
    const mockPosition = new mockVscode.Position(5, 0); // line 5 (0-indexed) -> store line 6

    // The mock asRelativePath returns uri.fsPath, so the relative path is '/test/src/app.ts'
    const relativePath = mockDoc.uri.fsPath;

    setup(() => {
        store = new ReviewStore();
        provider = new ReviewHoverProvider(store);
    });

    teardown(() => {
        provider.dispose();
        store.dispose();
    });

    test('no threads for file -> hover shows only "Add Review Comment" link', () => {
        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover, 'should return a hover');
        const md = hover.contents;
        assert.ok(md.value.includes('Add Review Comment'));
        assert.ok(!md.value.includes('Review thread'));
        assert.ok(!md.value.includes('Resolve'));
    });

    test('open thread on hovered line -> hover shows thread preview + reply + resolve', async () => {
        await store.addThread(relativePath, 6, 'Fix the bug here');

        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        const md = hover.contents;
        assert.ok(md.value.includes('Review thread'));
        assert.ok(md.value.includes('Fix the bug here'));
        assert.ok(md.value.includes('Add reply'));
        assert.ok(md.value.includes('Resolve'));
    });

    test('resolved thread on hovered line -> treated as no matching thread (shows Add Comment)', async () => {
        const thread = await store.addThread(relativePath, 6, 'Old issue');
        await store.setThreadStatus(thread.id, 'resolved');

        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        const md = hover.contents;
        // Still has threads in file, so not the early-exit path, but no open thread on this line
        assert.ok(md.value.includes('Add Review Comment'));
        assert.ok(!md.value.includes('Review thread'));
    });

    test('thread on different line -> hover shows "Add Review Comment" only', async () => {
        await store.addThread(relativePath, 20, 'Comment on line 20');

        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        const md = hover.contents;
        assert.ok(md.value.includes('Add Review Comment'));
        assert.ok(!md.value.includes('Review thread'));
    });

    test('hover content is trusted', () => {
        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        assert.strictEqual(hover.contents.isTrusted, true);
    });

    test('hover content is trusted when thread exists', async () => {
        await store.addThread(relativePath, 6, 'Trusted check');

        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        assert.strictEqual(hover.contents.isTrusted, true);
    });

    test('command URIs are well-formed - addComment', () => {
        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        const md = hover.contents;
        assert.ok(md.value.includes('command:ai-review.addComment'));
        const encodedArgs = encodeURIComponent(JSON.stringify([mockDoc.uri.toString(), 6]));
        assert.ok(md.value.includes(encodedArgs), `Expected encoded args in URI, got: ${md.value}`);
    });

    test('command URIs are well-formed - reply and resolve', async () => {
        const thread = await store.addThread(relativePath, 6, 'Check URIs');

        const hover = provider.provideHover(mockDoc, mockPosition) as any;
        assert.ok(hover);
        const md = hover.contents;

        assert.ok(md.value.includes('command:ai-review.replyToThread'));
        assert.ok(md.value.includes('command:ai-review.resolveThread'));

        const replyArgs = encodeURIComponent(JSON.stringify([thread.id]));
        const resolveArgs = encodeURIComponent(JSON.stringify([thread.id]));
        assert.ok(md.value.includes(replyArgs), 'Expected reply args in URI');
        assert.ok(md.value.includes(resolveArgs), 'Expected resolve args in URI');
    });
});

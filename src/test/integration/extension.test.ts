import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ReviewStore } from '../../reviewStore';
import { ReviewStorePersistence } from '../../reviewStorePersistence';

suite('ReviewStore Test Suite', () => {
	let store: ReviewStore;
	let persistence: ReviewStorePersistence;
	let tmpDir: string;
	let workspaceFolder: vscode.WorkspaceFolder;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-test-'));
		workspaceFolder = {
			uri: vscode.Uri.file(tmpDir),
			name: 'test',
			index: 0,
		};
		persistence = new ReviewStorePersistence();
		store = new ReviewStore();
		store.setPersistence(persistence);
		const data = await persistence.initialize(workspaceFolder);
		store.loadData(data);
	});

	teardown(() => {
		persistence.dispose();
		store.dispose();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('starts with no threads', () => {
		assert.strictEqual(store.getThreads().length, 0);
	});

	test('addThread creates a thread with one comment', async () => {
		const thread = await store.addThread('src/app.ts', 11, 'REVIEW: Fix this');
		assert.strictEqual(thread.filePath, 'src/app.ts');
		assert.strictEqual(thread.lineNumber, 11);
		assert.strictEqual(thread.status, 'open');
		assert.strictEqual(thread.comments.length, 1);
		assert.strictEqual(thread.comments[0].author, 'user');
		assert.strictEqual(thread.comments[0].body, 'REVIEW: Fix this');
	});

	test('getThreads returns all threads', async () => {
		await store.addThread('a.ts', 2, 'Comment A');
		await store.addThread('b.ts', 3, 'Comment B');
		assert.strictEqual(store.getThreads().length, 2);
	});

	test('getThreadsByFile filters by file path', async () => {
		await store.addThread('a.ts', 2, 'A');
		await store.addThread('b.ts', 3, 'B');
		await store.addThread('a.ts', 6, 'A2');
		const aThreads = store.getThreadsByFile('a.ts');
		assert.strictEqual(aThreads.length, 2);
	});

	test('getThread returns thread by id', async () => {
		const thread = await store.addThread('x.ts', 2, 'X');
		const found = store.getThread(thread.id);
		assert.ok(found);
		assert.strictEqual(found!.id, thread.id);
	});

	test('getThread returns undefined for unknown id', () => {
		assert.strictEqual(store.getThread('nonexistent'), undefined);
	});

	test('addComment appends to existing thread', async () => {
		const thread = await store.addThread('x.ts', 2, 'First');
		const comment = await store.addComment(thread.id, 'llm', 'LLM response');
		assert.ok(comment);
		assert.strictEqual(comment!.author, 'llm');
		const updated = store.getThread(thread.id)!;
		assert.strictEqual(updated.comments.length, 2);
		assert.strictEqual(updated.comments[1].body, 'LLM response');
	});

	test('addComment returns undefined for unknown thread', async () => {
		const result = await store.addComment('bad-id', 'user', 'nope');
		assert.strictEqual(result, undefined);
	});

	test('setThreadStatus changes status', async () => {
		const thread = await store.addThread('x.ts', 2, 'Check');
		assert.strictEqual(thread.status, 'open');
		const ok = await store.setThreadStatus(thread.id, 'resolved');
		assert.strictEqual(ok, true);
		assert.strictEqual(store.getThread(thread.id)!.status, 'resolved');
	});

	test('setThreadStatus returns false for unknown thread', async () => {
		const ok = await store.setThreadStatus('bad-id', 'resolved');
		assert.strictEqual(ok, false);
	});

	test('deleteThread removes thread', async () => {
		const thread = await store.addThread('x.ts', 2, 'Delete me');
		assert.strictEqual(store.getThreads().length, 1);
		const ok = await store.deleteThread(thread.id);
		assert.strictEqual(ok, true);
		assert.strictEqual(store.getThreads().length, 0);
	});

	test('deleteThread returns false for unknown thread', async () => {
		const ok = await store.deleteThread('bad-id');
		assert.strictEqual(ok, false);
	});

	test('persists data to .vscode/.ai-review.json', async () => {
		await store.addThread('file.ts', 6, 'Persist me');
		const filePath = path.join(tmpDir, '.vscode', '.ai-review.json');
		assert.ok(fs.existsSync(filePath));
		const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		assert.strictEqual(content.version, 1);
		assert.strictEqual(content.threads.length, 1);
		assert.strictEqual(content.threads[0].comments[0].body, 'Persist me');
	});

	test('loads persisted data on re-initialize', async () => {
		await store.addThread('file.ts', 6, 'Survive reload');
		persistence.dispose();
		store.dispose();

		const persistence2 = new ReviewStorePersistence();
		const store2 = new ReviewStore();
		store2.setPersistence(persistence2);
		const data2 = await persistence2.initialize(workspaceFolder);
		store2.loadData(data2);
		assert.strictEqual(store2.getThreads().length, 1);
		assert.strictEqual(store2.getThreads()[0].comments[0].body, 'Survive reload');
		persistence2.dispose();
		store2.dispose();
	});

	test('remapThreadsForRename updates file path for renamed file', async () => {
		const thread = await store.addThread('src\\old.ts', 3, 'Rename me');
		const changed = await store.remapThreadsForRename('src\\old.ts', 'src\\new.ts');
		assert.strictEqual(changed, 1);
		assert.strictEqual(store.getThread(thread.id)!.filePath, 'src/new.ts');
	});

	test('remapThreadsForRename updates nested paths for folder rename', async () => {
		const threadA = await store.addThread('src\\old\\a.ts', 2, 'A');
		const threadB = await store.addThread('src\\old\\nested\\b.ts', 2, 'B');
		const changed = await store.remapThreadsForRename('src\\old', 'src\\new');
		assert.strictEqual(changed, 2);
		assert.strictEqual(store.getThread(threadA.id)!.filePath, 'src/new/a.ts');
		assert.strictEqual(store.getThread(threadB.id)!.filePath, 'src/new/nested/b.ts');
	});

	test('removeThreadsForDeletedPath removes threads for deleted file and folder', async () => {
		await store.addThread('src\\keep.ts', 2, 'Keep');
		await store.addThread('src\\drop.ts', 3, 'Drop file');
		await store.addThread('src\\folder\\drop2.ts', 4, 'Drop folder');
		const removedFile = await store.removeThreadsForDeletedPath('src\\drop.ts');
		const removedFolder = await store.removeThreadsForDeletedPath('src\\folder');
		assert.strictEqual(removedFile, 1);
		assert.strictEqual(removedFolder, 1);
		assert.strictEqual(store.getThreads().length, 1);
		assert.strictEqual(store.getThreads()[0].filePath, 'src\\keep.ts');
	});

	test('remapThreadsForRename with forward-slash inputs', async () => {
		const thread = await store.addThread('src/old.ts', 3, 'Forward slash');
		const changed = await store.remapThreadsForRename('src/old.ts', 'src/new.ts');
		assert.strictEqual(changed, 1);
		assert.strictEqual(store.getThread(thread.id)!.filePath, 'src/new.ts');
	});

	test('remapThreadsForRename with mixed separator inputs', async () => {
		const thread = await store.addThread('src\\mixed/old.ts', 1, 'Mixed');
		const changed = await store.remapThreadsForRename('src/mixed/old.ts', 'src/mixed/new.ts');
		assert.strictEqual(changed, 1);
		assert.strictEqual(store.getThread(thread.id)!.filePath, 'src/mixed/new.ts');
	});

	test('remapThreadsForRename normalizes output to forward slashes', async () => {
		const thread = await store.addThread('src\\deep\\path\\file.ts', 1, 'Backslash stored');
		await store.remapThreadsForRename('src\\deep', 'src\\moved');
		assert.ok(!store.getThread(thread.id)!.filePath.includes('\\'), 'output should use forward slashes');
		assert.strictEqual(store.getThread(thread.id)!.filePath, 'src/moved/path/file.ts');
	});

	test('removeThreadsForDeletedPath works with forward-slash input', async () => {
		await store.addThread('src/forward.ts', 1, 'Forward');
		await store.addThread('src/keep.ts', 1, 'Keep');
		const removed = await store.removeThreadsForDeletedPath('src/forward.ts');
		assert.strictEqual(removed, 1);
		assert.strictEqual(store.getThreads().length, 1);
	});

	test('removeThreadsForDeletedPath matches backslash-stored paths with forward-slash input', async () => {
		await store.addThread('src\\backslash.ts', 1, 'Backslash stored');
		const removed = await store.removeThreadsForDeletedPath('src/backslash.ts');
		assert.strictEqual(removed, 1);
		assert.strictEqual(store.getThreads().length, 0);
	});

	test('onDidChangeThreads fires on addThread', async () => {
		let fired = false;
		store.onDidChangeThreads(() => { fired = true; });
		await store.addThread('x.ts', 2, 'Fire event');
		assert.strictEqual(fired, true);
	});
});

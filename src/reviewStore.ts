import { ReviewData, ReviewThread, ReviewComment, CURRENT_VERSION } from './models';
import { SimpleEventEmitter } from './events';
import { generateThreadId, generateCommentId } from './idGenerator';
import { adjustThreadLineNumbers } from './threadAnchorService';
import { remapThreadPaths, removeThreadsByPath } from './threadPathService';
import type { IReviewStorePersistence } from './reviewStorePersistence';
import type { ThreadChangeEvent } from './changeEvent';

export class ReviewStore {
    private data: ReviewData = { version: CURRENT_VERSION, threads: [] };
    private fileIndex = new Map<string, ReviewThread[]>();
    private persistence: IReviewStorePersistence | undefined;

    private readonly _onDidChangeThreads = new SimpleEventEmitter<ThreadChangeEvent>();
    public readonly onDidChangeThreads = this._onDidChangeThreads.event;

    setPersistence(persistence: IReviewStorePersistence): void {
        this.persistence = persistence;
    }

    loadData(data: ReviewData): void {
        if (data.version && Array.isArray(data.threads)) {
            this.data = data;
        }
        this.rebuildFileIndex();
        this._onDidChangeThreads.fire({ type: 'reload' });
    }

    // --- Getters ---

    getThreads(): ReadonlyArray<ReviewThread> {
        return this.data.threads;
    }

    getThreadsByFile(filePath: string): ReviewThread[] {
        return this.fileIndex.get(filePath) ?? [];
    }

    getOpenThreadsByFile(filePath: string): ReviewThread[] {
        return (this.fileIndex.get(filePath) ?? []).filter(t => t.status === 'open');
    }

    getThreadByFileAndLine(filePath: string, lineNumber: number): ReviewThread | undefined {
        return (this.fileIndex.get(filePath) ?? []).find(t => t.status === 'open' && t.lineNumber === lineNumber);
    }

    getThread(threadId: string): ReviewThread | undefined {
        return this.data.threads.find(t => t.id === threadId);
    }

    getData(): ReviewData {
        return this.data;
    }

    // --- CRUD Operations ---

    async addThread(filePath: string, lineNumber: number, body: string): Promise<ReviewThread> {
        const thread: ReviewThread = {
            id: generateThreadId(),
            filePath,
            lineNumber,
            status: 'open',
            createdAt: new Date().toISOString(),
            comments: [
                {
                    id: generateCommentId(),
                    author: 'user',
                    body,
                    timestamp: new Date().toISOString(),
                }
            ],
        };
        this.data.threads.push(thread);
        this.rebuildFileIndex();
        await this.save();
        this._onDidChangeThreads.fire({ type: 'add', threadId: thread.id, filePath });
        return thread;
    }

    async addComment(threadId: string, author: 'user' | 'llm', body: string): Promise<ReviewComment | undefined> {
        const thread = this.getThread(threadId);
        if (!thread) { return undefined; }
        const comment: ReviewComment = {
            id: generateCommentId(),
            author,
            body,
            timestamp: new Date().toISOString(),
        };
        thread.comments.push(comment);
        await this.save();
        this._onDidChangeThreads.fire({ type: 'update', threadId, filePath: thread.filePath });
        return comment;
    }

    async editComment(threadId: string, commentId: string, newBody: string, _editor: 'user' | 'llm' = 'user'): Promise<boolean> {
        const thread = this.getThread(threadId);
        if (!thread) { return false; }
        const comment = thread.comments.find(c => c.id === commentId);
        if (!comment) { return false; }
        comment.body = newBody;
        comment.editedAt = new Date().toISOString();
        await this.save();
        this._onDidChangeThreads.fire({ type: 'update', threadId, filePath: thread.filePath });
        return true;
    }

    async setThreadStatus(threadId: string, status: 'open' | 'resolved'): Promise<boolean> {
        const thread = this.getThread(threadId);
        if (!thread) { return false; }
        thread.status = status;
        await this.save();
        this._onDidChangeThreads.fire({ type: 'update', threadId, filePath: thread.filePath });
        return true;
    }

    async deleteThread(threadId: string): Promise<boolean> {
        const index = this.data.threads.findIndex(t => t.id === threadId);
        if (index === -1) { return false; }
        const filePath = this.data.threads[index].filePath;
        this.data.threads.splice(index, 1);
        this.rebuildFileIndex();
        await this.save();
        this._onDidChangeThreads.fire({ type: 'delete', threadId, filePath });
        return true;
    }

    async clearResolvedThreads(): Promise<number> {
        const before = this.data.threads.length;
        this.data.threads = this.data.threads.filter(t => t.status !== 'resolved');
        const removedCount = before - this.data.threads.length;
        if (removedCount > 0) {
            this.rebuildFileIndex();
            await this.save();
            this._onDidChangeThreads.fire({ type: 'reload' });
        }
        return removedCount;
    }

    // --- Anchor & path operations (delegate to extracted services) ---

    async adjustLineNumbers(filePath: string, changeStart: number, delta: number): Promise<void> {
        if (delta === 0) { return; }
        const changed = adjustThreadLineNumbers(this.data.threads, filePath, changeStart, delta);
        if (changed) {
            await this.save();
            this._onDidChangeThreads.fire({ type: 'update', filePath });
        }
    }

    async remapThreadsForRename(oldPath: string, newPath: string): Promise<number> {
        if (!oldPath || !newPath || oldPath === newPath) { return 0; }
        const changedCount = remapThreadPaths(this.data.threads, oldPath, newPath);
        if (changedCount > 0) {
            this.rebuildFileIndex();
            await this.save();
            this._onDidChangeThreads.fire({ type: 'reload' });
        }
        return changedCount;
    }

    async removeThreadsForDeletedPath(deletedPath: string): Promise<number> {
        if (!deletedPath) { return 0; }
        const { remaining, removedCount } = removeThreadsByPath(this.data.threads, deletedPath);
        if (removedCount > 0) {
            this.data.threads = remaining;
            this.rebuildFileIndex();
            await this.save();
            this._onDidChangeThreads.fire({ type: 'reload' });
        }
        return removedCount;
    }

    private rebuildFileIndex(): void {
        this.fileIndex.clear();
        for (const thread of this.data.threads) {
            let fileThreads = this.fileIndex.get(thread.filePath);
            if (!fileThreads) {
                fileThreads = [];
                this.fileIndex.set(thread.filePath, fileThreads);
            }
            fileThreads.push(thread);
        }
    }

    private async save(): Promise<void> {
        await this.persistence?.save(this.data);
    }

    dispose(): void {
        this._onDidChangeThreads.dispose();
    }
}

import * as path from 'path';
import { ReviewData, ReviewThread, ReviewComment } from './models';
import { generateThreadId, generateCommentId } from './idGenerator';

const CURRENT_VERSION = 1;

/** Minimal event interface matching vscode.EventEmitter's shape */
interface SimpleEvent<T> {
    (listener: (e: T) => void): { dispose(): void };
}

class SimpleEventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];

    readonly event: SimpleEvent<T> = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };

    fire(data: T): void {
        for (const listener of this.listeners) {
            listener(data);
        }
    }

    dispose(): void {
        this.listeners = [];
    }
}

/** Persistence interface — implemented by ReviewStorePersistence for real I/O, or mocked in tests */
export interface IPersistence {
    save(data: ReviewData): Promise<void>;
}

export class ReviewStore {
    private data: ReviewData = { version: CURRENT_VERSION, threads: [] };
    private persistence: IPersistence | undefined;

    private readonly _onDidChangeThreads = new SimpleEventEmitter<void>();
    public readonly onDidChangeThreads = this._onDidChangeThreads.event;

    /**
     * Attach a persistence backend. Called by extension.ts after creating both objects.
     */
    setPersistence(persistence: IPersistence): void {
        this.persistence = persistence;
    }

    /**
     * Load data from an external source (called after persistence.initialize()).
     */
    loadData(data: ReviewData): void {
        if (data.version && Array.isArray(data.threads)) {
            this.data = data;
        }
        this._onDidChangeThreads.fire();
    }

    // --- CRUD Operations ---

    getThreads(): ReadonlyArray<ReviewThread> {
        return this.data.threads;
    }

    getThreadsByFile(filePath: string): ReviewThread[] {
        return this.data.threads.filter(t => t.filePath === filePath);
    }

    getOpenThreadsByFile(filePath: string): ReviewThread[] {
        return this.data.threads.filter(t => t.filePath === filePath && t.status === 'open');
    }

    getThreadByFileAndLine(filePath: string, lineNumber: number): ReviewThread | undefined {
        return this.data.threads.find(t => t.filePath === filePath && t.status === 'open' && t.lineNumber === lineNumber);
    }

    getThread(threadId: string): ReviewThread | undefined {
        return this.data.threads.find(t => t.id === threadId);
    }

    getData(): ReviewData {
        return this.data;
    }

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
        await this.save();
        this._onDidChangeThreads.fire();
        return thread;
    }

    async addComment(threadId: string, author: 'user' | 'llm', body: string): Promise<ReviewComment | undefined> {
        const thread = this.getThread(threadId);
        if (!thread) {
            return undefined;
        }
        const comment: ReviewComment = {
            id: generateCommentId(),
            author,
            body,
            timestamp: new Date().toISOString(),
        };
        thread.comments.push(comment);
        await this.save();
        this._onDidChangeThreads.fire();
        return comment;
    }

    async editComment(threadId: string, commentId: string, newBody: string, editor: 'user' | 'llm' = 'user'): Promise<boolean> {
        const thread = this.getThread(threadId);
        if (!thread) {
            return false;
        }
        const comment = thread.comments.find(c => c.id === commentId);
        if (!comment) {
            return false;
        }
        comment.body = newBody;
        comment.editedAt = new Date().toISOString();
        await this.save();
        this._onDidChangeThreads.fire();
        return true;
    }

    async setThreadStatus(threadId: string, status: 'open' | 'resolved'): Promise<boolean> {
        const thread = this.getThread(threadId);
        if (!thread) {
            return false;
        }
        thread.status = status;
        await this.save();
        this._onDidChangeThreads.fire();
        return true;
    }

    async deleteThread(threadId: string): Promise<boolean> {
        const index = this.data.threads.findIndex(t => t.id === threadId);
        if (index === -1) {
            return false;
        }
        this.data.threads.splice(index, 1);
        await this.save();
        this._onDidChangeThreads.fire();
        return true;
    }

    /**
     * Remove all resolved threads from the store.
     * Returns the number of threads removed.
     */
    async clearResolvedThreads(): Promise<number> {
        const before = this.data.threads.length;
        this.data.threads = this.data.threads.filter(t => t.status !== 'resolved');
        const removedCount = before - this.data.threads.length;
        if (removedCount > 0) {
            await this.save();
            this._onDidChangeThreads.fire();
        }
        return removedCount;
    }

    /**
     * Adjust thread line numbers for a file when lines are inserted or deleted.
     * Called by DocumentChangeTracker on every document change.
     *
     * @param filePath   Relative file path
     * @param changeStart  The line where the edit started
     * @param delta        Positive = lines inserted, negative = lines deleted
     */
    async adjustLineNumbers(filePath: string, changeStart: number, delta: number): Promise<void> {
        if (delta === 0) { return; }
        let changed = false;

        for (const thread of this.data.threads) {
            if (thread.filePath !== filePath) { continue; }

            if (thread.lineNumber > changeStart) {
                // Thread is below or inside the edit — shift it (clamped to changeStart)
                thread.lineNumber = Math.max(changeStart, thread.lineNumber + delta);
                changed = true;
            }
        }

        if (changed) {
            await this.save();
            this._onDidChangeThreads.fire();
        }
    }

    /**
     * Remap thread file paths after a file/folder rename.
     * Supports exact file renames and folder renames.
     */
    async remapThreadsForRename(oldPath: string, newPath: string): Promise<number> {
        if (!oldPath || !newPath || oldPath === newPath) {
            return 0;
        }

        const oldExact = oldPath.toLowerCase();
        const oldPrefix = oldPath.endsWith(path.sep) ? oldPath : `${oldPath}${path.sep}`;
        const oldPrefixLower = oldPrefix.toLowerCase();
        let changedCount = 0;

        for (const thread of this.data.threads) {
            const threadPathLower = thread.filePath.toLowerCase();
            if (threadPathLower === oldExact) {
                thread.filePath = newPath;
                changedCount++;
                continue;
            }
            if (threadPathLower.startsWith(oldPrefixLower)) {
                const suffix = thread.filePath.slice(oldPrefix.length);
                thread.filePath = path.join(newPath, suffix);
                changedCount++;
            }
        }

        if (changedCount > 0) {
            await this.save();
            this._onDidChangeThreads.fire();
        }

        return changedCount;
    }

    /**
     * Remove threads for a deleted file/folder path.
     * Supports exact file deletes and folder deletes.
     */
    async removeThreadsForDeletedPath(deletedPath: string): Promise<number> {
        if (!deletedPath) {
            return 0;
        }

        const deletedExact = deletedPath.toLowerCase();
        const deletedPrefix = deletedPath.endsWith(path.sep)
            ? deletedPath
            : `${deletedPath}${path.sep}`;
        const deletedPrefixLower = deletedPrefix.toLowerCase();
        const before = this.data.threads.length;

        this.data.threads = this.data.threads.filter(thread => {
            const threadPathLower = thread.filePath.toLowerCase();
            return threadPathLower !== deletedExact && !threadPathLower.startsWith(deletedPrefixLower);
        });

        const removedCount = before - this.data.threads.length;
        if (removedCount > 0) {
            await this.save();
            this._onDidChangeThreads.fire();
        }

        return removedCount;
    }

    private async save(): Promise<void> {
        await this.persistence?.save(this.data);
    }

    dispose(): void {
        this._onDidChangeThreads.dispose();
    }
}

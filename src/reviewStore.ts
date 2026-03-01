import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewData, ReviewThread, ReviewComment } from './models';

const STORE_DIRNAME = '.vscode';
const STORE_FILENAME = '.ai-review.json';
const CURRENT_VERSION = 1;

export class ReviewStore implements vscode.Disposable {
    private data: ReviewData = { version: CURRENT_VERSION, threads: [] };
    private filePath: string | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    private readonly _onDidChangeThreads = new vscode.EventEmitter<void>();
    public readonly onDidChangeThreads = this._onDidChangeThreads.event;

    constructor() {
        this.disposables.push(this._onDidChangeThreads);
    }

    /**
     * Initialize the store for the given workspace folder.
     * Loads existing data and starts watching for external changes.
     */
    async initialize(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const storeDirPath = path.join(workspaceFolder.uri.fsPath, STORE_DIRNAME);
        this.filePath = path.join(storeDirPath, STORE_FILENAME);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(storeDirPath));
        await this.load();
        this.watchFile();
    }

    // --- CRUD Operations ---

    getThreads(): ReadonlyArray<ReviewThread> {
        return this.data.threads;
    }

    getThreadsByFile(filePath: string): ReviewThread[] {
        return this.data.threads.filter(t => t.filePath === filePath);
    }

    getThread(threadId: string): ReviewThread | undefined {
        return this.data.threads.find(t => t.id === threadId);
    }

    async addThread(filePath: string, lineNumber: number, body: string): Promise<ReviewThread> {
        const thread: ReviewThread = {
            id: generateId(),
            filePath,
            lineNumber,
            status: 'open',
            createdAt: new Date().toISOString(),
            comments: [
                {
                    id: generateId(),
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
            id: generateId(),
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
                // Thread is below the edit — shift it
                thread.lineNumber = Math.max(changeStart, thread.lineNumber + delta);
                changed = true;
            } else if (delta < 0 && thread.lineNumber > changeStart + delta) {
                // Thread's line was inside the deleted range — clamp to change start
                thread.lineNumber = changeStart;
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

    // --- Persistence ---

    private async load(): Promise<void> {
        if (!this.filePath) {
            return;
        }
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(this.filePath));
            const parsed = JSON.parse(Buffer.from(content).toString('utf-8')) as ReviewData;
            if (parsed.version && Array.isArray(parsed.threads)) {
                this.data = parsed;
            }
        } catch {
            this.data = { version: CURRENT_VERSION, threads: [] };
        }
    }

    private async save(): Promise<void> {
        if (!this.filePath) {
            return;
        }
        const autoSave = vscode.workspace
            .getConfiguration('aiReview')
            .get<boolean>('autoSave', true);
        if (!autoSave) {
            return;
        }
        await this.writeDataToPath(this.filePath);
    }

    private async writeDataToPath(targetPath: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
        const content = JSON.stringify(this.data, null, 2);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(content, 'utf-8'));
    }

    private watchFile(): void {
        if (!this.filePath) {
            return;
        }
        const pattern = new vscode.RelativePattern(
            path.dirname(this.filePath),
            STORE_FILENAME
        );
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.fileWatcher.onDidChange(async () => {
            await this.load();
            this._onDidChangeThreads.fire();
        });
        this.fileWatcher.onDidCreate(async () => {
            await this.load();
            this._onDidChangeThreads.fire();
        });
        this.fileWatcher.onDidDelete(() => {
            this.data = { version: CURRENT_VERSION, threads: [] };
            this._onDidChangeThreads.fire();
        });
        this.disposables.push(this.fileWatcher);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

function generateId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

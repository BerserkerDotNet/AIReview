import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewData, CURRENT_VERSION } from './models';
import { logWarn } from './logger';

const STORE_DIRNAME = '.vscode';
const STORE_FILENAME = '.ai-review.json';

export interface IReviewStorePersistence extends vscode.Disposable {
    initialize(workspaceFolder: vscode.WorkspaceFolder): Promise<ReviewData>;
    save(data: ReviewData): Promise<void>;
    onExternalChange: vscode.Event<ReviewData>;
}

export class ReviewStorePersistence implements IReviewStorePersistence {
    private filePath: string | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private pendingWrites = 0;
    private lastWriteTime = 0;
    /**
     * Grace period (ms) after a write completes before external file-watcher
     * events are treated as genuine.
     *
     * When we save `.ai-review.json`, the OS fires a file-system change event.
     * Without this settle window the watcher would reload the file we just wrote,
     * triggering a redundant `loadData → onDidChangeThreads → syncFromStore` cycle.
     * This causes:
     *  • A visible UI flicker as every comment thread is rebuilt.
     *  • Wasted CPU re-parsing JSON we already hold in memory.
     *  • Potential data race if the user is mid-edit (the re-sync resets the
     *    comment widgets back to Preview mode, losing unsaved text).
     *
     * 1 000 ms is generous enough for slow file systems and antivirus hooks,
     * while still reacting promptly to truly external edits (e.g. a `git stash pop`
     * that rewrites the file).
     */
    private static readonly WRITE_SETTLE_MS = 1000;
    private disposables: vscode.Disposable[] = [];

    private readonly _onExternalChange = new vscode.EventEmitter<ReviewData>();
    public readonly onExternalChange = this._onExternalChange.event;

    constructor() {
        this.disposables.push(this._onExternalChange);
    }

    async initialize(workspaceFolder: vscode.WorkspaceFolder): Promise<ReviewData> {
        const storeDirPath = path.join(workspaceFolder.uri.fsPath, STORE_DIRNAME);
        this.filePath = path.join(storeDirPath, STORE_FILENAME);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(storeDirPath));
        const data = await this.load();
        this.watchFile();
        return data;
    }

    async save(data: ReviewData): Promise<void> {
        if (!this.filePath) {
            return;
        }
        const autoSave = vscode.workspace
            .getConfiguration('aiReview')
            .get<boolean>('autoSave', true);
        if (!autoSave) {
            return;
        }
        this.pendingWrites++;
        try {
            await this.writeDataToPath(this.filePath, data);
        } finally {
            this.pendingWrites--;
            this.lastWriteTime = Date.now();
        }
    }

    private async load(): Promise<ReviewData> {
        if (!this.filePath || this.isOwnWrite()) {
            return { version: CURRENT_VERSION, threads: [] };
        }
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(this.filePath));
            const parsed = JSON.parse(Buffer.from(content).toString('utf-8')) as ReviewData;
            if (parsed.version && Array.isArray(parsed.threads)) {
                return parsed;
            }
        } catch (error) {
            const isFileNotFound =
                error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
                || (error as any).code === 'FileNotFound';
            if (!isFileNotFound) {
                logWarn('Failed to load review data', error);
            }
        }
        return { version: CURRENT_VERSION, threads: [] };
    }

    /** True if a write is in progress or one just completed (FS events may still be settling). */
    private isOwnWrite(): boolean {
        return this.pendingWrites > 0
            || (Date.now() - this.lastWriteTime) < ReviewStorePersistence.WRITE_SETTLE_MS;
    }

    private async writeDataToPath(targetPath: string, data: ReviewData): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
        const content = JSON.stringify(data, null, 2);
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
        this.disposables.push(
            this.fileWatcher.onDidChange(async () => {
                if (this.isOwnWrite()) { return; }
                try {
                    const data = await this.load();
                    this._onExternalChange.fire(data);
                } catch (err) {
                    logWarn('Error reloading on file change', err);
                }
            }),
            this.fileWatcher.onDidCreate(async () => {
                if (this.isOwnWrite()) { return; }
                try {
                    const data = await this.load();
                    this._onExternalChange.fire(data);
                } catch (err) {
                    logWarn('Error reloading on file create', err);
                }
            }),
            this.fileWatcher.onDidDelete(() => {
                this._onExternalChange.fire({ version: CURRENT_VERSION, threads: [] });
            }),
            this.fileWatcher,
        );
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

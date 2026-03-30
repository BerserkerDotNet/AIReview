import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewData } from './models';

const STORE_DIRNAME = '.vscode';
const STORE_FILENAME = '.ai-review.json';
const CURRENT_VERSION = 1;

export interface IReviewStorePersistence extends vscode.Disposable {
    initialize(workspaceFolder: vscode.WorkspaceFolder): Promise<ReviewData>;
    save(data: ReviewData): Promise<void>;
    onExternalChange: vscode.Event<ReviewData>;
}

export class ReviewStorePersistence implements IReviewStorePersistence {
    private filePath: string | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private saving = false;
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
        this.saving = true;
        try {
            await this.writeDataToPath(this.filePath, data);
        } finally {
            // Keep flag true briefly so the file watcher ignores our own write.
            // The watcher event fires asynchronously after the write completes.
            setTimeout(() => { this.saving = false; }, 500);
        }
    }

    private async load(): Promise<ReviewData> {
        if (!this.filePath || this.saving) {
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
                console.warn('AI Review: Failed to load review data', error);
            }
        }
        return { version: CURRENT_VERSION, threads: [] };
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
                if (this.saving) { return; }
                try {
                    const data = await this.load();
                    this._onExternalChange.fire(data);
                } catch (err) {
                    console.warn('AI Review: Error reloading on file change', err);
                }
            }),
            this.fileWatcher.onDidCreate(async () => {
                if (this.saving) { return; }
                try {
                    const data = await this.load();
                    this._onExternalChange.fire(data);
                } catch (err) {
                    console.warn('AI Review: Error reloading on file create', err);
                }
            }),
            this.fileWatcher.onDidDelete(() => {
                this._onExternalChange.fire({ version: CURRENT_VERSION, threads: [] });
            }),
            this.fileWatcher,
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

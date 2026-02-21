import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';

/**
 * Keeps .ai-review.json thread paths in sync when files/folders are renamed or deleted.
 */
export class FileLifecycleTracker implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(private store: ReviewStore) {
        this.disposables.push(
            vscode.workspace.onDidRenameFiles(e => {
                void this.handleRename(e);
            }),
            vscode.workspace.onDidDeleteFiles(e => {
                void this.handleDelete(e);
            })
        );
    }

    private async handleRename(event: vscode.FileRenameEvent): Promise<void> {
        for (const renamed of event.files) {
            const oldPath = vscode.workspace.asRelativePath(renamed.oldUri, false);
            const newPath = vscode.workspace.asRelativePath(renamed.newUri, false);
            await this.store.remapThreadsForRename(oldPath, newPath);
        }
    }

    private async handleDelete(event: vscode.FileDeleteEvent): Promise<void> {
        for (const deleted of event.files) {
            const deletedPath = vscode.workspace.asRelativePath(deleted, false);
            await this.store.removeThreadsForDeletedPath(deletedPath);
        }
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

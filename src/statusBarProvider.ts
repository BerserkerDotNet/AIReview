import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';

export class StatusBarProvider implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    constructor(private store: ReviewStore) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'workbench.action.focusCommentsPanel';
        this.statusBarItem.tooltip = 'Open Review Comments Panel';

        this.disposables.push(
            store.onDidChangeThreads(() => this.update())
        );

        this.update();
        this.statusBarItem.show();
    }

    private update(): void {
        const threads = this.store.getThreads();

        if (threads.length === 0) {
            this.statusBarItem.hide();
            return;
        }

        let openCount = 0;
        let resolvedCount = 0;
        for (const t of threads) {
            if (t.status === 'open') { openCount++; }
            else if (t.status === 'resolved') { resolvedCount++; }
        }

        this.statusBarItem.text = `💬 ${openCount} open`;
        if (resolvedCount > 0) {
            this.statusBarItem.text += ` · ✅ ${resolvedCount}`;
        }
        this.statusBarItem.show();
    }

    dispose(): void {
        this.statusBarItem.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

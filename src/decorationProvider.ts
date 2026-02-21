import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewStore } from './reviewStore';

export class DecorationProvider implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private decorationType: vscode.TextEditorDecorationType;

    constructor(
        private store: ReviewStore,
        context: vscode.ExtensionContext,
    ) {
        const iconPath = vscode.Uri.file(
            path.join(context.extensionPath, 'resources', 'comment.svg')
        );

        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: iconPath,
            gutterIconSize: 'contain',
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForegroundColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });

        this.disposables.push(this.decorationType);

        // Refresh decorations when threads change
        this.disposables.push(
            store.onDidChangeThreads(() => this.refreshAll())
        );

        // Refresh when active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll())
        );

        // Refresh when a document is opened
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(() => this.refreshAll())
        );

        // Initial decoration
        this.refreshAll();
    }

    private refreshAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.refreshEditor(editor);
        }
    }

    private refreshEditor(editor: vscode.TextEditor): void {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspaceFolder) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const threads = this.store.getThreadsByFile(relativePath)
            .filter(t => t.status === 'open');

        const ranges: vscode.DecorationOptions[] = threads.map(thread => {
            const line = Math.max(0, Math.min(thread.lineNumber, editor.document.lineCount - 1));
            const range = editor.document.lineAt(line).range;
            const preview = thread.comments[0]?.body ?? '';
            const commandUri = vscode.Uri.parse(
                `command:ai-review.goToThread?${encodeURIComponent(JSON.stringify([thread.filePath, thread.lineNumber]))}`
            );
            const hoverMessage = new vscode.MarkdownString(
                `💬 **Review:** ${preview}\n\n[Go to thread](${commandUri})`
            );
            hoverMessage.isTrusted = true;
            return {
                range,
                hoverMessage,
            };
        });

        editor.setDecorations(this.decorationType, ranges);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

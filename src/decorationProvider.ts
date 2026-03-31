import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewStore } from './reviewStore';
import { buildCommandUri } from './utils';
import type { ThreadChangeEvent } from './changeEvent';

export class DecorationProvider implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private decorationType: vscode.TextEditorDecorationType;
    private readonly iconPath: vscode.Uri;

    constructor(
        private store: ReviewStore,
        context: vscode.ExtensionContext,
    ) {
        this.iconPath = vscode.Uri.file(
            path.join(context.extensionPath, 'resources', 'comment.svg')
        );

        this.decorationType = this.createDecorationType();

        // Refresh decorations when threads change (scoped to affected file when possible)
        this.disposables.push(
            store.onDidChangeThreads((event: ThreadChangeEvent) => {
                if (event.filePath && event.type !== 'reload') {
                    for (const editor of vscode.window.visibleTextEditors) {
                        const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
                        if (rel === event.filePath) {
                            this.refreshEditor(editor);
                        }
                    }
                } else {
                    this.refreshAll();
                }
            })
        );

        // Refresh when active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll())
        );

        // Refresh when a document is opened
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(() => this.refreshAll())
        );

        // Recreate decorations when the configured color changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration('aiReview.decorationBackgroundColor')) {
                    return;
                }
                this.decorationType.dispose();
                this.decorationType = this.createDecorationType();
                this.refreshAll();
            })
        );

        // Initial decoration
        this.refreshAll();
    }

    private createDecorationType(): vscode.TextEditorDecorationType {
        const configuredColor = vscode.workspace
            .getConfiguration('aiReview')
            .get<string>('decorationBackgroundColor', '')
            .trim();

        return vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.iconPath,
            gutterIconSize: 'contain',
            backgroundColor: configuredColor || new vscode.ThemeColor('diffEditor.insertedTextBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForegroundColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
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
        const threads = this.store.getOpenThreadsByFile(relativePath);

        const ranges: vscode.DecorationOptions[] = threads.map(thread => {
            const line = Math.max(0, Math.min(thread.lineNumber - 1, editor.document.lineCount - 1));  // store 1-indexed → VS Code 0-indexed
            const range = editor.document.lineAt(line).range;
            const preview = thread.comments[0]?.body ?? '';
            const commandUri = buildCommandUri('ai-review.goToThread', [thread.filePath, thread.lineNumber]);
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
        this.decorationType.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

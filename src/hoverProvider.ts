import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { buildCommandUri } from './utils';

export class ReviewHoverProvider implements vscode.HoverProvider, vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(private store: ReviewStore) {
        // Register for all languages
        this.disposables.push(
            vscode.languages.registerHoverProvider({ scheme: 'file' }, this)
        );
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | undefined {
        const relativePath = vscode.workspace.asRelativePath(document.uri, false);
        const fileThreads = this.store.getThreadsByFile(relativePath);

        // Fast path: no threads in this file — just show "Add Comment" link
        if (fileThreads.length === 0) {
            const commandUri = buildCommandUri('ai-review.addComment', [document.uri.toString(), position.line + 1]);
            const md = new vscode.MarkdownString();
            md.isTrusted = true;
            md.appendMarkdown(`[💬 Add Review Comment](${commandUri})`);
            return new vscode.Hover(md);
        }

        const thread = this.store.getThreadByFileAndLine(relativePath, position.line + 1);  // VS Code 0-indexed → store 1-indexed

        const commandUri = buildCommandUri('ai-review.addComment', [document.uri.toString(), position.line + 1]);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        if (thread) {
            const preview = thread.comments[0]?.body ?? '';
            md.appendMarkdown(`💬 **Review thread:** ${preview}\n\n`);
            const replyUri = buildCommandUri('ai-review.replyToThread', [thread.id]);
            const resolveUri = buildCommandUri('ai-review.resolveThread', [thread.id]);
            md.appendMarkdown(`[➕ Add reply](${replyUri}) · `);
            md.appendMarkdown(`[✅ Resolve](${resolveUri})`);
        } else {
            md.appendMarkdown(`[💬 Add Review Comment](${commandUri})`);
        }

        return new vscode.Hover(md);
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';

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
        const threads = this.store.getThreadsByFile(relativePath)
            .filter(t => t.status === 'open' && t.lineNumber === position.line);

        const commandUri = vscode.Uri.parse(
            `command:ai-review.addComment?${encodeURIComponent(JSON.stringify([document.uri.toString(), position.line]))}`
        );

        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        if (threads.length > 0) {
            const thread = threads[0];
            const preview = thread.comments[0]?.body ?? '';
            md.appendMarkdown(`💬 **Review thread:** ${preview}\n\n`);
            md.appendMarkdown(`[➕ Add reply](command:ai-review.replyToThread?${encodeURIComponent(JSON.stringify([thread.id]))}) · `);
            md.appendMarkdown(`[✅ Resolve](command:ai-review.resolveThread?${encodeURIComponent(JSON.stringify([thread.id]))})`);
        } else {
            md.appendMarkdown(`[💬 Add Review Comment](${commandUri})`);
        }

        return new vscode.Hover(md);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

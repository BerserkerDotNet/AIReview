import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { ReviewThread } from './models';

export class ReviewCommentController implements vscode.Disposable {
    private controller: vscode.CommentController;
    private disposables: vscode.Disposable[] = [];
    // Maps store thread id → VS Code CommentThread
    private threadMap = new Map<string, vscode.CommentThread>();

    constructor(private store: ReviewStore) {
        this.controller = vscode.comments.createCommentController(
            'ai-review',
            'AI Review'
        );
        this.controller.options = {
            placeHolder: 'Add a REVIEW comment...',
            prompt: 'Add a REVIEW comment...',
        };

        // Allow commenting on any line in any file
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument) => {
                return [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
            },
        };

        // Handle new comment created via the native comment widget
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.submitComment',
                (reply: vscode.CommentReply) => this.handleNewComment(reply)
            )
        );

        // Handle reply via the native comment widget
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.submitReply',
                (reply: vscode.CommentReply) => this.handleReply(reply)
            )
        );

        // Handle resolve via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.resolveCommentThread',
                (thread: vscode.CommentThread) => this.handleResolve(thread)
            )
        );

        // Handle unresolve via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.unresolveCommentThread',
                (thread: vscode.CommentThread) => this.handleUnresolve(thread)
            )
        );

        // Handle delete via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.deleteCommentThread',
                (thread: vscode.CommentThread) => this.handleDelete(thread)
            )
        );

        // Sync when store changes externally (file watcher, etc.)
        this.disposables.push(
            store.onDidChangeThreads(() => this.syncFromStore())
        );

        this.disposables.push(this.controller);
    }

    /** Build/rebuild all VS Code CommentThread objects from the store. */
    async syncFromStore(): Promise<void> {
        const storeIds = new Set(this.store.getThreads().map(t => t.id));

        // Remove threads that no longer exist in the store
        for (const [id, thread] of this.threadMap) {
            if (!storeIds.has(id)) {
                thread.dispose();
                this.threadMap.delete(id);
            }
        }

        // Add or update threads
        for (const reviewThread of this.store.getThreads()) {
            const existing = this.threadMap.get(reviewThread.id);
            if (existing) {
                this.updateVscodeThread(existing, reviewThread);
            } else {
                const created = this.createVscodeThread(reviewThread);
                if (created) {
                    this.threadMap.set(reviewThread.id, created);
                }
            }
        }
    }

    private createVscodeThread(reviewThread: ReviewThread): vscode.CommentThread | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, reviewThread.filePath);
        const line = Math.max(0, reviewThread.lineNumber);
        const range = new vscode.Range(line, 0, line, 0);
        const comments = this.toVscodeComments(reviewThread);

        const thread = this.controller.createCommentThread(uri, range, comments);
        thread.contextValue = reviewThread.id;
        this.applyThreadState(thread, reviewThread);
        return thread;
    }

    private updateVscodeThread(thread: vscode.CommentThread, reviewThread: ReviewThread): void {
        thread.comments = this.toVscodeComments(reviewThread);
        this.applyThreadState(thread, reviewThread);
    }

    private applyThreadState(thread: vscode.CommentThread, reviewThread: ReviewThread): void {
        thread.label = reviewThread.status === 'resolved' ? '✅ Resolved' : undefined;
        thread.state = reviewThread.status === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        thread.canReply = reviewThread.status === 'open';
    }

    private toVscodeComments(reviewThread: ReviewThread): vscode.Comment[] {
        return reviewThread.comments.map(c => ({
            body: new vscode.MarkdownString(c.body),
            mode: vscode.CommentMode.Preview,
            author: { name: c.author === 'user' ? 'You' : 'AI' },
            timestamp: new Date(c.timestamp),
        }));
    }

    // --- Command handlers ---

    private async handleNewComment(reply: vscode.CommentReply): Promise<void> {
        const uri = reply.thread.uri;
        const line = reply.thread.range?.start.line ?? 0;
        const relativePath = vscode.workspace.asRelativePath(uri, false);

        // Dispose the placeholder thread VS Code created; syncFromStore will rebuild
        reply.thread.dispose();

        await this.store.addThread(relativePath, line, reply.text);
        // store fires onDidChangeThreads → syncFromStore
    }

    private async handleReply(reply: vscode.CommentReply): Promise<void> {
        const threadId = reply.thread.contextValue;
        if (!threadId) { return; }
        await this.store.addComment(threadId, 'user', reply.text);
    }

    private async handleResolve(thread: vscode.CommentThread): Promise<void> {
        const threadId = thread.contextValue;
        if (!threadId) { return; }
        await this.store.setThreadStatus(threadId, 'resolved');
    }

    private async handleUnresolve(thread: vscode.CommentThread): Promise<void> {
        const threadId = thread.contextValue;
        if (!threadId) { return; }
        await this.store.setThreadStatus(threadId, 'open');
    }

    private async handleDelete(thread: vscode.CommentThread): Promise<void> {
        const threadId = thread.contextValue;
        if (!threadId) { return; }
        await this.store.deleteThread(threadId);
    }

    dispose(): void {
        for (const [, thread] of this.threadMap) {
            thread.dispose();
        }
        this.threadMap.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

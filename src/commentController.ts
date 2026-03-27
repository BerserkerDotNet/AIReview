import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewStore } from './reviewStore';
import { ReviewThread } from './models';
import { buildCommandUri } from './utils';

export class ReviewCommentController implements vscode.Disposable {
    private controller: vscode.CommentController;
    private disposables: vscode.Disposable[] = [];
    // Maps store thread id → VS Code CommentThread
    private threadMap = new Map<string, vscode.CommentThread>();

    constructor(private store: ReviewStore) {
        this.controller = vscode.comments.createCommentController(
            'ai-review',
            'AI Changes Review'
        );
        this.controller.options = {
            placeHolder: 'Add a review comment...',
            prompt: 'Add a review comment...',
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

        // Handle start edit — opens a pre-filled InputBox immediately (reliable cross-version approach)
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.startEdit',
                (...args: unknown[]) => this.handleStartEdit(args)
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

        // If the stored path is absolute (external file), use it directly;
        // otherwise join with the workspace root.
        const uri = path.isAbsolute(reviewThread.filePath)
            ? vscode.Uri.file(reviewThread.filePath)
            : vscode.Uri.joinPath(workspaceFolders[0].uri, reviewThread.filePath);
        const line = Math.max(0, reviewThread.lineNumber - 1);  // store 1-indexed → VS Code 0-indexed
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
        return reviewThread.comments.map(c => {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(c.body);
            if (c.author === 'user') {
                const editUri = buildCommandUri('ai-review.startEdit', [reviewThread.id, c.id]);
                md.appendMarkdown(`\n\n[Edit](${editUri})`);
                md.isTrusted = true;
            }
            return {
                body: md,
                mode: vscode.CommentMode.Preview,
                author: { name: c.author === 'user' ? 'You' : 'AI' },
                timestamp: new Date(c.timestamp),
                contextValue: c.author === 'user' ? `comment:${reviewThread.id}:${c.id}` : undefined,
            } as vscode.Comment;
        });
    }

    // --- Command handlers ---

    private async handleNewComment(reply: vscode.CommentReply): Promise<void> {
        const uri = reply.thread.uri;
        const line = (reply.thread.range?.start.line ?? 0) + 1;  // VS Code 0-indexed → store 1-indexed
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

    private async handleStartEdit(args: unknown[]): Promise<void> {
        let threadId: string | undefined;
        let commentId: string | undefined;

        if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
            threadId = args[0];
            commentId = args[1];
        } else if (args.length >= 1 && Array.isArray(args[0]) && args[0].length >= 2) {
            threadId = String(args[0][0]);
            commentId = String(args[0][1]);
        }

        if (!threadId || !commentId) { return; }

        const reviewThread = this.store.getThread(threadId);
        if (!reviewThread) { return; }

        const comment = reviewThread.comments.find(c => c.id === commentId);
        if (!comment) { return; }

        const newBody = await vscode.window.showInputBox({
            prompt: 'Edit comment',
            value: comment.body,
            validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
        });
        if (newBody === undefined) { return; }

        await this.store.editComment(threadId, commentId, newBody.trim());
        // store fires onDidChangeThreads → syncFromStore
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

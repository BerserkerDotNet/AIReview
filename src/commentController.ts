import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewStore } from './reviewStore';
import { ReviewThread } from './models';

/** Custom Comment class that tracks store IDs and supports cancel-on-edit. */
export class ReviewNoteComment implements vscode.Comment {
    savedBody: string;

    constructor(
        public body: string | vscode.MarkdownString,
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public threadId: string,
        public commentId: string,
        plainBody: string,
        public timestamp?: Date,
        public contextValue?: string,
        public label?: string,
    ) {
        this.savedBody = plainBody;
    }
}

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

        // Native inline edit — switches comment to editing mode
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.editCommentInline',
                (comment: ReviewNoteComment) => this.handleEditInline(comment)
            )
        );

        // Save edit — persists updated body from inline editor
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.saveCommentEdit',
                (comment: ReviewNoteComment) => this.handleSaveEdit(comment)
            )
        );

        // Cancel edit — restores original body
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.cancelCommentEdit',
                (comment: ReviewNoteComment) => this.handleCancelEdit(comment)
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
        this.applyThreadState(thread, reviewThread);
        return thread;
    }

    private updateVscodeThread(thread: vscode.CommentThread, reviewThread: ReviewThread): void {
        // Apply state (label, contextValue, etc.) BEFORE reassigning comments.
        // The comments setter triggers VS Code's re-render, which picks up
        // all property changes made beforehand.
        this.applyThreadState(thread, reviewThread);
        thread.comments = this.toVscodeComments(reviewThread);
    }

    private applyThreadState(thread: vscode.CommentThread, reviewThread: ReviewThread): void {
        thread.label = reviewThread.status === 'resolved' ? '✅ Resolved' : '💬 Open';
        thread.state = reviewThread.status === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        thread.canReply = reviewThread.status === 'open';
        thread.contextValue = reviewThread.status; // 'open' or 'resolved'
    }

    /** Extract the store thread ID by reverse-looking up the VS Code thread in the map. */
    private getThreadId(thread: vscode.CommentThread): string | undefined {
        for (const [id, t] of this.threadMap) {
            if (t === thread) { return id; }
        }
        return undefined;
    }

    private toVscodeComments(reviewThread: ReviewThread): ReviewNoteComment[] {
        return reviewThread.comments.map(c => {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(c.body);
            if (c.editedAt) {
                md.appendMarkdown(' *(edited)*');
            }
            md.isTrusted = true;

            return new ReviewNoteComment(
                md,
                vscode.CommentMode.Preview,
                { name: c.author === 'user' ? 'You' : 'AI' },
                reviewThread.id,
                c.id,
                c.body,
                new Date(c.timestamp),
                c.author === 'user' ? 'editable' : undefined,
            );
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
        const threadId = this.getThreadId(reply.thread);
        if (!threadId) { return; }
        await this.store.addComment(threadId, 'user', reply.text);
    }

    private async handleResolve(thread: vscode.CommentThread): Promise<void> {
        const threadId = this.getThreadId(thread);
        if (!threadId) { return; }
        await this.store.setThreadStatus(threadId, 'resolved');
    }

    private async handleUnresolve(thread: vscode.CommentThread): Promise<void> {
        const threadId = this.getThreadId(thread);
        if (!threadId) { return; }
        await this.store.setThreadStatus(threadId, 'open');
    }

    private async handleDelete(thread: vscode.CommentThread): Promise<void> {
        const threadId = this.getThreadId(thread);
        if (!threadId) { return; }
        await this.store.deleteThread(threadId);
    }

    private handleEditInline(comment: ReviewNoteComment): void {
        if (!comment.threadId || !comment.commentId) { return; }
        comment.body = comment.savedBody;
        comment.mode = vscode.CommentMode.Editing;

        const thread = this.threadMap.get(comment.threadId);
        if (thread) {
            thread.comments = [...thread.comments];
        }
    }

    private async handleSaveEdit(comment: ReviewNoteComment): Promise<void> {
        if (!comment.threadId || !comment.commentId) { return; }
        const newBody = typeof comment.body === 'string'
            ? comment.body
            : comment.body.value;

        if (!newBody.trim()) { return; }

        await this.store.editComment(comment.threadId, comment.commentId, newBody.trim());
        // store fires onDidChangeThreads → syncFromStore rebuilds in Preview mode
    }

    private handleCancelEdit(_comment: ReviewNoteComment): void {
        this.syncFromStore();
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

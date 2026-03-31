import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewStore } from './reviewStore';
import { ReviewThread } from './models';
import type { ThreadChangeEvent } from './changeEvent';
import {
    ThreadMapLookup,
    handleNewComment,
    handleReply,
    handleResolve,
    handleUnresolve,
    handleDelete,
    handleEditInline,
    handleSaveEdit,
    handleCancelEdit,
} from './commentCommands';

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

export class ReviewCommentController implements vscode.Disposable, ThreadMapLookup {
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
                (reply: vscode.CommentReply) => handleNewComment(reply, this.store)
            )
        );

        // Handle reply via the native comment widget
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.submitReply',
                (reply: vscode.CommentReply) => handleReply(reply, this.store, this)
            )
        );

        // Handle resolve via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.resolveCommentThread',
                (thread: vscode.CommentThread) => handleResolve(thread, this.store, this)
            )
        );

        // Handle unresolve via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.unresolveCommentThread',
                (thread: vscode.CommentThread) => handleUnresolve(thread, this.store, this)
            )
        );

        // Handle delete via thread context menu button
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.deleteCommentThread',
                (thread: vscode.CommentThread) => handleDelete(thread, this.store, this)
            )
        );

        // Native inline edit — switches comment to editing mode
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.editCommentInline',
                (comment: ReviewNoteComment) => handleEditInline(comment, this)
            )
        );

        // Save edit — persists updated body from inline editor
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.saveCommentEdit',
                (comment: ReviewNoteComment) => handleSaveEdit(comment, this.store)
            )
        );

        // Cancel edit — restores original body
        this.disposables.push(
            vscode.commands.registerCommand(
                'ai-review.cancelCommentEdit',
                () => handleCancelEdit(this)
            )
        );

        // Sync when store changes externally (file watcher, etc.)
        this.disposables.push(
            store.onDidChangeThreads((event) => this.syncFromStore(event))
        );

        this.disposables.push(this.controller);
    }

    /** Build/rebuild all VS Code CommentThread objects from the store, or apply a targeted update. */
    async syncFromStore(event?: ThreadChangeEvent): Promise<void> {
        if (!event) {
            return this.fullSync();
        }

        switch (event.type) {
            case 'reload':
                return this.fullSync();

            case 'delete':
                return this.syncDeletedThread(event.threadId);

            case 'add':
            case 'update':
                if (event.threadId) {
                    return this.syncSingleThread(event.threadId);
                }
                if (event.filePath) {
                    return this.syncFileThreads(event.filePath);
                }
                return this.fullSync();
        }
    }

    private syncDeletedThread(threadId?: string): void {
        if (!threadId) { return; }
        const existing = this.threadMap.get(threadId);
        if (existing) {
            existing.dispose();
            this.threadMap.delete(threadId);
        }
    }

    private syncSingleThread(threadId: string): void {
        const reviewThread = this.store.getThread(threadId);
        if (!reviewThread) { return; }
        const existing = this.threadMap.get(threadId);
        if (existing) {
            this.updateVscodeThread(existing, reviewThread);
        } else {
            const created = this.createVscodeThread(reviewThread);
            if (created) {
                this.threadMap.set(reviewThread.id, created);
            }
        }
    }

    private syncFileThreads(filePath: string): void {
        const fileThreads = this.store.getThreadsByFile(filePath);
        const fileThreadIds = new Set(fileThreads.map(t => t.id));

        for (const reviewThread of fileThreads) {
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

        // Remove stale threads for this file that are no longer in the store
        for (const [id, thread] of this.threadMap) {
            const relativePath = vscode.workspace.asRelativePath(thread.uri, false);
            if (relativePath === filePath && !fileThreadIds.has(id)) {
                thread.dispose();
                this.threadMap.delete(id);
            }
        }
    }

    private async fullSync(): Promise<void> {
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
    getThreadId(thread: vscode.CommentThread): string | undefined {
        for (const [id, mappedThread] of this.threadMap) {
            if (mappedThread === thread) { return id; }
        }
        return undefined;
    }

    getThreadMap(): Map<string, vscode.CommentThread> {
        return this.threadMap;
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

    dispose(): void {
        for (const [, thread] of this.threadMap) {
            thread.dispose();
        }
        this.threadMap.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

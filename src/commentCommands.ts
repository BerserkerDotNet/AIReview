import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { ReviewNoteComment } from './commentController';
import type { ThreadChangeEvent } from './changeEvent';

/** Provides command handlers with access to the controller's thread map. */
export type ThreadMapLookup = {
    getThreadId(thread: vscode.CommentThread): string | undefined;
    getThreadMap(): Map<string, vscode.CommentThread>;
    syncFromStore(event?: ThreadChangeEvent): Promise<void>;
};

export async function handleNewComment(reply: vscode.CommentReply, store: ReviewStore): Promise<void> {
    const uri = reply.thread.uri;
    const line = (reply.thread.range?.start.line ?? 0) + 1;  // VS Code 0-indexed → store 1-indexed
    const relativePath = vscode.workspace.asRelativePath(uri, false);

    // Dispose the placeholder thread VS Code created; syncFromStore will rebuild
    reply.thread.dispose();

    await store.addThread(relativePath, line, reply.text);
    // store fires onDidChangeThreads → syncFromStore
}

export async function handleReply(reply: vscode.CommentReply, store: ReviewStore, lookup: ThreadMapLookup): Promise<void> {
    const threadId = lookup.getThreadId(reply.thread);
    if (!threadId) { return; }
    await store.addComment(threadId, 'user', reply.text);
}

export async function handleResolve(thread: vscode.CommentThread, store: ReviewStore, lookup: ThreadMapLookup): Promise<void> {
    const threadId = lookup.getThreadId(thread);
    if (!threadId) { return; }
    await store.setThreadStatus(threadId, 'resolved');
}

export async function handleUnresolve(thread: vscode.CommentThread, store: ReviewStore, lookup: ThreadMapLookup): Promise<void> {
    const threadId = lookup.getThreadId(thread);
    if (!threadId) { return; }
    await store.setThreadStatus(threadId, 'open');
}

export async function handleDelete(thread: vscode.CommentThread, store: ReviewStore, lookup: ThreadMapLookup): Promise<void> {
    const threadId = lookup.getThreadId(thread);
    if (!threadId) { return; }
    await store.deleteThread(threadId);
}

export function handleEditInline(comment: ReviewNoteComment, lookup: ThreadMapLookup): void {
    if (!comment.threadId || !comment.commentId) { return; }
    comment.body = comment.savedBody;
    comment.mode = vscode.CommentMode.Editing;

    const thread = lookup.getThreadMap().get(comment.threadId);
    if (thread) {
        thread.comments = [...thread.comments];
    }
}

export async function handleSaveEdit(comment: ReviewNoteComment, store: ReviewStore): Promise<void> {
    if (!comment.threadId || !comment.commentId) { return; }
    const newBody = typeof comment.body === 'string'
        ? comment.body
        : comment.body.value;

    if (!newBody.trim()) { return; }

    await store.editComment(comment.threadId, comment.commentId, newBody.trim());
    // store fires onDidChangeThreads → syncFromStore rebuilds in Preview mode
}

export function handleCancelEdit(lookup: ThreadMapLookup): void {
    lookup.syncFromStore();
}

import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';

/**
 * Registers all commands for creating/managing review comments.
 * Covers Phase 3 (add comment, reply) and Phase 4 (resolve/unresolve/delete via commands).
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    store: ReviewStore,
    onThreadsChanged: () => void,
): void {
    // 3b/3c/3d: Add new review comment (from hover, context menu, or command palette)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.addComment',
            async (uriStr?: string, line?: number) => {
                // If not called with args, use active editor selection
                let targetUri: vscode.Uri | undefined;
                let targetLine: number | undefined;

                if (uriStr && line !== undefined) {
                    targetUri = vscode.Uri.parse(uriStr);
                    targetLine = line;
                } else {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('No active editor.');
                        return;
                    }
                    targetUri = editor.document.uri;
                    targetLine = editor.selection.active.line;
                }

                const body = await vscode.window.showInputBox({
                    prompt: `Add review comment for line ${(targetLine ?? 0) + 1}`,
                    placeHolder: 'REVIEW: describe the concern...',
                    validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
                });
                if (!body) { return; }

                const relativePath = vscode.workspace.asRelativePath(targetUri, false);
                await store.addThread(relativePath, targetLine ?? 0, body.trim());
                onThreadsChanged();
            }
        )
    );

    // 3d: Reply to existing thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.replyToThread',
            async (threadId?: string) => {
                const id = threadId ?? await pickThread(store);
                if (!id) { return; }

                const body = await vscode.window.showInputBox({
                    prompt: 'Add reply',
                    placeHolder: 'Your reply...',
                    validateInput: (val) => val.trim() ? undefined : 'Reply cannot be empty',
                });
                if (!body) { return; }

                await store.addComment(id, 'user', body.trim());
                onThreadsChanged();
            }
        )
    );

    // 4e: Resolve thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.resolveThread',
            async (threadId?: string) => {
                const id = threadId ?? await pickThread(store, 'open');
                if (!id) { return; }
                await store.setThreadStatus(id, 'resolved');
                onThreadsChanged();
            }
        )
    );

    // 4e: Unresolve thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.unresolveThread',
            async (threadId?: string) => {
                const id = threadId ?? await pickThread(store, 'resolved');
                if (!id) { return; }
                await store.setThreadStatus(id, 'open');
                onThreadsChanged();
            }
        )
    );

    // Delete thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.deleteThread',
            async (threadId?: string) => {
                const id = threadId ?? await pickThread(store);
                if (!id) { return; }
                const confirm = await vscode.window.showWarningMessage(
                    'Delete this review thread?',
                    { modal: true },
                    'Delete'
                );
                if (confirm !== 'Delete') { return; }
                await store.deleteThread(id);
                onThreadsChanged();
            }
        )
    );

    // Edit comment
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.editComment',
            async (threadId?: string, commentId?: string) => {
                const id = threadId ?? await pickThread(store);
                if (!id) { return; }
                const thread = store.getThread(id);
                if (!thread) { return; }
                const items = thread.comments.map(c => ({
                    label: c.author === 'user' ? 'You' : 'AI',
                    description: new Date(c.timestamp).toLocaleString(),
                    detail: c.body,
                    id: c.id,
                }));
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a comment to edit',
                });
                const cid = commentId ?? picked?.id;
                if (!cid) { return; }
                const comment = thread.comments.find(c => c.id === cid);
                if (!comment) { return; }
                const newBody = await vscode.window.showInputBox({
                    prompt: 'Edit comment',
                    value: comment.body,
                    validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
                });
                if (newBody === undefined) { return; }
                await store.editComment(id, cid, newBody.trim(), 'user');
                onThreadsChanged();
            }
        )
    );
}

async function pickThread(
    store: ReviewStore,
    status?: 'open' | 'resolved',
): Promise<string | undefined> {
    const threads = store.getThreads()
        .filter(t => !status || t.status === status);

    if (threads.length === 0) {
        vscode.window.showInformationMessage('No review threads found.');
        return undefined;
    }

    const items = threads.map(t => ({
        label: `$(comment) ${t.filePath}:${t.lineNumber + 1}`,
        description: t.comments[0]?.body.slice(0, 60) ?? '',
        id: t.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a review thread',
    });
    return picked?.id;
}

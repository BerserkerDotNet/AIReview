import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { withCommandErrorHandling, pickThread } from './commandUtils';
import { registerSetupCopilotPluginCommand } from './setupCopilotPluginCommand';
import { navigateToThread, findNextThread, findPreviousThread } from './threadNavigation';

/**
 * Registers all commands for creating/managing review comments.
 * Covers Phase 3 (add comment, reply) and Phase 4 (resolve/unresolve/delete via commands).
 *
 * Note: Store mutations fire onDidChangeThreads, which the CommentController
 * listens to for syncing. No explicit sync callback is needed here.
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    store: ReviewStore,
): void {
    const registerCommand = (commandId: string, handler: (...args: any[]) => Promise<void>) =>
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, withCommandErrorHandling(commandId, handler)),
        );

    // 3b/3c/3d: Add new review comment (from hover, context menu, or command palette)
    registerCommand('ai-review.addComment', async (uriStr?: string, line?: number) => {
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
            targetLine = editor.selection.active.line + 1; // VS Code 0-indexed → store 1-indexed
        }

        const body = await vscode.window.showInputBox({
            prompt: `Add review comment for line ${targetLine ?? 1}`,
            placeHolder: 'REVIEW: describe the concern...',
            validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
        });
        if (!body) { return; }

        const relativePath = vscode.workspace.asRelativePath(targetUri, false);
        await store.addThread(relativePath, targetLine ?? 1, body.trim());
    });

    // 3d: Reply to existing thread
    registerCommand('ai-review.replyToThread', async (threadId?: string) => {
        const id = threadId ?? await pickThread(store);
        if (!id) { return; }

        const body = await vscode.window.showInputBox({
            prompt: 'Add reply',
            placeHolder: 'Your reply...',
            validateInput: (val) => val.trim() ? undefined : 'Reply cannot be empty',
        });
        if (!body) { return; }

        await store.addComment(id, 'user', body.trim());
    });

    // 4e: Resolve thread
    registerCommand('ai-review.resolveThread', async (threadId?: string) => {
        const id = threadId ?? await pickThread(store, 'open');
        if (!id) { return; }
        await store.setThreadStatus(id, 'resolved');
    });

    // 4e: Unresolve thread
    registerCommand('ai-review.unresolveThread', async (threadId?: string) => {
        const id = threadId ?? await pickThread(store, 'resolved');
        if (!id) { return; }
        await store.setThreadStatus(id, 'open');
    });

    // Delete thread
    registerCommand('ai-review.deleteThread', async (threadId?: string) => {
        const id = threadId ?? await pickThread(store);
        if (!id) { return; }
        const confirm = await vscode.window.showWarningMessage(
            'Delete this review thread?',
            { modal: true },
            'Delete'
        );
        if (confirm !== 'Delete') { return; }
        await store.deleteThread(id);
    });

    // Edit comment
    registerCommand('ai-review.editComment', async (threadId?: string, commentId?: string) => {
        const id = threadId ?? await pickThread(store);
        if (!id) { return; }
        const thread = store.getThread(id);
        if (!thread) { return; }

        let targetCommentId = commentId;
        if (!targetCommentId) {
            const userComments = thread.comments.filter(c => c.author === 'user');
            if (userComments.length === 0) {
                vscode.window.showInformationMessage('No editable comments in this thread.');
                return;
            }
            const items = userComments.map(c => ({
                label: 'You',
                description: new Date(c.timestamp).toLocaleString(),
                detail: c.body,
                id: c.id,
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a comment to edit',
            });
            targetCommentId = picked?.id;
        }
        if (!targetCommentId) { return; }
        const comment = thread.comments.find(c => c.id === targetCommentId);
        if (!comment) { return; }
        const newBody = await vscode.window.showInputBox({
            prompt: 'Edit comment',
            value: comment.body,
            validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
        });
        if (newBody === undefined) { return; }
        await store.editComment(id, targetCommentId, newBody.trim(), 'user');
    });

    // Reopen thread (alias for unresolve, more discoverable name)
    registerCommand('ai-review.reopenThread', async (threadId?: string) => {
        const id = threadId ?? await pickThread(store, 'resolved');
        if (!id) { return; }
        await store.setThreadStatus(id, 'open');
    });

    // Clear all resolved threads
    registerCommand('ai-review.clearResolvedThreads', async () => {
        const resolvedCount = store.getThreads().filter(t => t.status === 'resolved').length;
        if (resolvedCount === 0) {
            vscode.window.showInformationMessage('No resolved threads to clear.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(
            `Delete ${resolvedCount} resolved thread${resolvedCount === 1 ? '' : 's'}? This cannot be undone.`,
            { modal: true },
            'Delete'
        );
        if (confirm !== 'Delete') { return; }
        const removed = await store.clearResolvedThreads();
        vscode.window.showInformationMessage(`Cleared ${removed} resolved thread${removed === 1 ? '' : 's'}.`);
    });

    // Resolve thread at the current cursor line (keyboard shortcut)
    registerCommand('ai-review.resolveThreadAtLine', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }
        const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const line = editor.selection.active.line + 1; // 0-indexed → 1-indexed
        const thread = store.getThreadByFileAndLine(relativePath, line);
        if (!thread) {
            vscode.window.showInformationMessage('No open review thread at this line.');
            return;
        }
        await store.setThreadStatus(thread.id, 'resolved');
    });

    // Navigate to next review thread
    registerCommand('ai-review.nextThread', async () => {
        const editor = vscode.window.activeTextEditor;
        const allThreads = store.getThreads().filter(t => t.status === 'open');
        if (allThreads.length === 0) {
            vscode.window.showInformationMessage('No open review threads.');
            return;
        }

        const currentFile = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined;
        const currentLine = editor ? editor.selection.active.line + 1 : 0;

        const target = findNextThread(allThreads, currentFile, currentLine);
        if (target) { await navigateToThread(target); }
    });

    // Navigate to previous review thread
    registerCommand('ai-review.previousThread', async () => {
        const editor = vscode.window.activeTextEditor;
        const allThreads = store.getThreads().filter(t => t.status === 'open');
        if (allThreads.length === 0) {
            vscode.window.showInformationMessage('No open review threads.');
            return;
        }

        const currentFile = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined;
        const currentLine = editor ? editor.selection.active.line + 1 : 0;

        const target = findPreviousThread(allThreads, currentFile, currentLine);
        if (target) { await navigateToThread(target); }
    });

    // Setup Copilot Plugin (extracted to its own module)
    registerSetupCopilotPluginCommand(context);
}

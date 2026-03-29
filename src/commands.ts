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
                try {
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
                        targetLine = editor.selection.active.line + 1;  // VS Code 0-indexed → store 1-indexed
                    }

                    const body = await vscode.window.showInputBox({
                        prompt: `Add review comment for line ${targetLine ?? 1}`,
                        placeHolder: 'REVIEW: describe the concern...',
                        validateInput: (val) => val.trim() ? undefined : 'Comment cannot be empty',
                    });
                    if (!body) { return; }

                    const relativePath = vscode.workspace.asRelativePath(targetUri, false);
                    await store.addThread(relativePath, targetLine ?? 1, body.trim());
                    onThreadsChanged();
                } catch (err) {
                    console.error('AI Review: addComment failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // 3d: Reply to existing thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.replyToThread',
            async (threadId?: string) => {
                try {
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
                } catch (err) {
                    console.error('AI Review: replyToThread failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // 4e: Resolve thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.resolveThread',
            async (threadId?: string) => {
                try {
                    const id = threadId ?? await pickThread(store, 'open');
                    if (!id) { return; }
                    await store.setThreadStatus(id, 'resolved');
                    onThreadsChanged();
                } catch (err) {
                    console.error('AI Review: resolveThread failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // 4e: Unresolve thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.unresolveThread',
            async (threadId?: string) => {
                try {
                    const id = threadId ?? await pickThread(store, 'resolved');
                    if (!id) { return; }
                    await store.setThreadStatus(id, 'open');
                    onThreadsChanged();
                } catch (err) {
                    console.error('AI Review: unresolveThread failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // Delete thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.deleteThread',
            async (threadId?: string) => {
                try {
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
                } catch (err) {
                    console.error('AI Review: deleteThread failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // Edit comment
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.editComment',
            async (threadId?: string, commentId?: string) => {
                try {
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
                } catch (err) {
                    console.error('AI Review: editComment failed', err);
                    vscode.window.showErrorMessage(`AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`);
                }
            }
        )
    );

    // Setup Copilot Plugin
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ai-review.setupCopilotPlugin',
            async () => {
                const items: vscode.QuickPickItem[] = [
                    {
                        label: '$(terminal) Add marketplace catalog',
                        description: 'Copy command to clipboard',
                        detail: '/plugin marketplace add BerserkerDotNet/AIReview',
                    },
                    {
                        label: '$(package) Install plugin',
                        description: 'Copy command to clipboard',
                        detail: '/plugin install feedback-resolver@ai-changes-review-marketplace',
                    },
                    {
                        label: '$(link-external) Open documentation',
                        description: 'View on GitHub',
                        detail: 'Opens the plugin documentation in your browser',
                    },
                ];

                const picked = await vscode.window.showQuickPick(items, {
                    title: 'Setup Copilot Resolve-Comments Plugin',
                    placeHolder: 'Select an action to set up the companion Copilot plugin',
                });

                if (!picked) { return; }

                if (picked.label.includes('Add marketplace catalog')) {
                    await vscode.env.clipboard.writeText('/plugin marketplace add BerserkerDotNet/AIReview');
                    vscode.window.showInformationMessage('Copied to clipboard: /plugin marketplace add BerserkerDotNet/AIReview');
                } else if (picked.label.includes('Install plugin')) {
                    await vscode.env.clipboard.writeText('/plugin install feedback-resolver@ai-changes-review-marketplace');
                    vscode.window.showInformationMessage('Copied to clipboard: /plugin install feedback-resolver@ai-changes-review-marketplace');
                } else if (picked.label.includes('Open documentation')) {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/BerserkerDotNet/AIReview/tree/master/.github/plugins/feedback-resolver'));
                }
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
        label: `$(comment) ${t.filePath}:${t.lineNumber}`,
        description: t.comments[0]?.body.slice(0, 60) ?? '',
        id: t.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a review thread',
    });
    return picked?.id;
}

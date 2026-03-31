import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { logError } from './logger';

/**
 * Wraps a command handler with uniform error handling.
 * Logs the error and shows a user-facing error message.
 */
export function withCommandErrorHandling(
    commandName: string,
    handler: (...args: any[]) => Promise<void>,
): (...args: any[]) => Promise<void> {
    return async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (err) {
            logError(`${commandName} failed`, err);
            vscode.window.showErrorMessage(
                `AI Review: ${err instanceof Error ? err.message : 'An error occurred'}`,
            );
        }
    };
}

/**
 * Shows a QuickPick to let the user select a review thread.
 * Optionally filters by thread status.
 */
export async function pickThread(
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

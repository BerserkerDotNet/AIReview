import * as vscode from 'vscode';
import { ReviewThread } from './models';

/** Navigate the editor to a thread's location. */
export async function navigateToThread(thread: { filePath: string; lineNumber: number }): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, thread.filePath);
    const line = thread.lineNumber - 1; // 1-indexed → 0-indexed
    await vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(line, 0, line, 0),
    });
}

/**
 * Find the next thread after `currentLine` in `currentFile`, wrapping
 * within the file then across files alphabetically.
 */
export function findNextThread(
    threads: ReadonlyArray<ReviewThread>,
    currentFile: string | undefined,
    currentLine: number,
): ReviewThread | undefined {
    if (currentFile) {
        const fileThreads = threads
            .filter(t => t.filePath === currentFile)
            .sort((a, b) => a.lineNumber - b.lineNumber);

        const next = fileThreads.find(t => t.lineNumber > currentLine);
        if (next) { return next; }
        if (fileThreads.length > 0) {
            if (fileThreads[0].lineNumber !== currentLine) { return fileThreads[0]; }
        }
    }

    const files = [...new Set(threads.map(t => t.filePath))].sort();
    const currentIdx = currentFile ? files.indexOf(currentFile) : -1;
    const orderedFiles = [...files.slice(currentIdx + 1), ...files.slice(0, currentIdx + 1)];
    for (const file of orderedFiles) {
        if (file === currentFile) { continue; }
        const fileThreads = threads
            .filter(t => t.filePath === file)
            .sort((a, b) => a.lineNumber - b.lineNumber);
        if (fileThreads.length > 0) { return fileThreads[0]; }
    }

    if (currentFile) {
        const fileThreads = threads.filter(t => t.filePath === currentFile);
        if (fileThreads.length > 0) { return fileThreads[0]; }
    }
    return undefined;
}

/**
 * Find the previous thread before `currentLine` in `currentFile`, wrapping
 * within the file then across files reverse-alphabetically.
 */
export function findPreviousThread(
    threads: ReadonlyArray<ReviewThread>,
    currentFile: string | undefined,
    currentLine: number,
): ReviewThread | undefined {
    if (currentFile) {
        const fileThreads = threads
            .filter(t => t.filePath === currentFile)
            .sort((a, b) => b.lineNumber - a.lineNumber);

        const prev = fileThreads.find(t => t.lineNumber < currentLine);
        if (prev) { return prev; }
        if (fileThreads.length > 0) {
            if (fileThreads[0].lineNumber !== currentLine) { return fileThreads[0]; }
        }
    }

    const files = [...new Set(threads.map(t => t.filePath))].sort();
    const currentIdx = currentFile ? files.indexOf(currentFile) : files.length;
    const orderedFiles = [...files.slice(0, currentIdx).reverse(), ...files.slice(currentIdx).reverse()];
    for (const file of orderedFiles) {
        if (file === currentFile) { continue; }
        const fileThreads = threads
            .filter(t => t.filePath === file)
            .sort((a, b) => b.lineNumber - a.lineNumber);
        if (fileThreads.length > 0) { return fileThreads[0]; }
    }

    if (currentFile) {
        const fileThreads = threads.filter(t => t.filePath === currentFile);
        if (fileThreads.length > 0) { return fileThreads[0]; }
    }
    return undefined;
}

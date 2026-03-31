import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';

/** Debounce delay in ms — avoids hammering the JSON file while the user types */
const DEBOUNCE_MS = 500;

/**
 * Tracks text document changes and updates thread line numbers in the store
 * when lines are inserted or deleted above/within annotated lines.
 */
export class DocumentChangeTracker implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private store: ReviewStore) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e))
        );
    }

    private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        if (event.contentChanges.length === 0) { return; }

        const relativePath = vscode.workspace.asRelativePath(event.document.uri, false);

        // Only track files that have threads
        if (this.store.getThreadsByFile(relativePath).length === 0) { return; }

        // Collect all adjustments from this batch of changes
        // Changes are applied in order; we must process from last to first
        // to avoid earlier shifts invalidating later line positions.
        const adjustments = computeAdjustments(event.contentChanges);

        const key = relativePath;
        const existing = this.debounceTimers.get(key);
        if (existing) { clearTimeout(existing); }

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(key);
            for (const { changeStart, delta } of adjustments) {
                await this.store.adjustLineNumbers(relativePath, changeStart, delta);
            }
        }, DEBOUNCE_MS);

        this.debounceTimers.set(key, timer);
    }



    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Compute line adjustments for each content change.
 * Processes changes in reverse order (bottom-to-top) so that line shifts
 * from one change don't affect the anchor lines of earlier changes.
 */
export function computeAdjustments(
    changes: ReadonlyArray<{ range: { start: { line: number }; end: { line: number } }; text: string }>
): Array<{ changeStart: number; delta: number }> {
    // Sort descending by start line so bottom changes are applied first
    const sorted = [...changes].sort((a, b) => b.range.start.line - a.range.start.line);

    return sorted.map(change => {
        const linesRemoved = change.range.end.line - change.range.start.line;
        const linesAdded = (change.text.match(/\n/g) ?? []).length;
        const delta = linesAdded - linesRemoved;
        return { changeStart: change.range.start.line + 1, delta };  // VS Code 0-indexed → store 1-indexed
    }).filter(a => a.delta !== 0);
}

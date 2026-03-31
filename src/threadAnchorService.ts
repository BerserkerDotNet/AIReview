import { ReviewThread } from './models';

/**
 * Adjust thread line numbers for a file when lines are inserted or deleted.
 * @returns true if any thread was modified
 */
export function adjustThreadLineNumbers(
    threads: ReviewThread[],
    filePath: string,
    changeStart: number,
    delta: number
): boolean {
    let changed = false;

    for (const thread of threads) {
        if (thread.filePath !== filePath) { continue; }

        if (thread.lineNumber > changeStart) {
            thread.lineNumber = Math.max(changeStart, thread.lineNumber + delta);
            changed = true;
        }
    }

    return changed;
}

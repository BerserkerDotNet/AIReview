import { ReviewThread } from './models';
import { normalizePath } from './pathUtils';

/**
 * Remap thread file paths after a file/folder rename.
 * Supports exact file renames and folder renames.
 * @returns the number of threads updated
 */
export function remapThreadPaths(threads: ReviewThread[], oldPath: string, newPath: string): number {
    const normOld = normalizePath(oldPath);
    const normNew = normalizePath(newPath);
    const oldExact = normOld.toLowerCase();
    const oldPrefix = normOld.endsWith('/') ? normOld : `${normOld}/`;
    const oldPrefixLower = oldPrefix.toLowerCase();
    let changedCount = 0;

    for (const thread of threads) {
        const threadPathLower = normalizePath(thread.filePath).toLowerCase();
        if (threadPathLower === oldExact) {
            thread.filePath = normNew;
            changedCount++;
            continue;
        }
        if (threadPathLower.startsWith(oldPrefixLower)) {
            const suffix = normalizePath(thread.filePath).slice(oldPrefix.length);
            thread.filePath = `${normNew}/${suffix}`;
            changedCount++;
        }
    }

    return changedCount;
}

/**
 * Remove threads whose file path matches a deleted file or falls under a deleted folder.
 * @returns the remaining threads and the count of removed threads
 */
export function removeThreadsByPath(
    threads: ReviewThread[],
    deletedPath: string
): { remaining: ReviewThread[]; removedCount: number } {
    const normDeleted = normalizePath(deletedPath);
    const deletedExact = normDeleted.toLowerCase();
    const deletedPrefix = normDeleted.endsWith('/')
        ? normDeleted
        : `${normDeleted}/`;
    const deletedPrefixLower = deletedPrefix.toLowerCase();
    const before = threads.length;

    const remaining = threads.filter(thread => {
        const threadPathLower = normalizePath(thread.filePath).toLowerCase();
        return threadPathLower !== deletedExact && !threadPathLower.startsWith(deletedPrefixLower);
    });

    return { remaining, removedCount: before - remaining.length };
}

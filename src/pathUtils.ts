/** Normalize path to forward slashes for consistent cross-platform matching. */
export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

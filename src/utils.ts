import * as vscode from 'vscode';

/**
 * Build a command URI that can be used in MarkdownString links.
 */
export function buildCommandUri(command: string, args: unknown[]): vscode.Uri {
    return vscode.Uri.parse(
        `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
    );
}

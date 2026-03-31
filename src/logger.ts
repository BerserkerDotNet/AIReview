import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('AI Changes Review');
    }
    return outputChannel;
}

export function logInfo(message: string): void {
    getChannel().appendLine(`[INFO] ${message}`);
}

export function logWarn(message: string, error?: unknown): void {
    const suffix = error ? `: ${error instanceof Error ? error.message : String(error)}` : '';
    getChannel().appendLine(`[WARN] ${message}${suffix}`);
}

export function logError(message: string, error?: unknown): void {
    const suffix = error ? `: ${error instanceof Error ? error.stack ?? error.message : String(error)}` : '';
    getChannel().appendLine(`[ERROR] ${message}${suffix}`);
}

export function disposeLogger(): void {
    outputChannel?.dispose();
    outputChannel = undefined;
}

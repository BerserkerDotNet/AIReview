import * as vscode from 'vscode';

/**
 * Registers the ai-review.setupCopilotPlugin command.
 * Extracted from commands.ts because it is unrelated to review CRUD.
 */
export function registerSetupCopilotPluginCommand(
    context: vscode.ExtensionContext,
): void {
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

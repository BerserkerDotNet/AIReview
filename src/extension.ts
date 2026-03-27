import * as vscode from 'vscode';
import { ReviewStore } from './reviewStore';
import { ReviewStorePersistence } from './reviewStorePersistence';
import { DecorationProvider } from './decorationProvider';
import { ReviewHoverProvider } from './hoverProvider';
import { ReviewCommentController } from './commentController';
import { registerCommands } from './commands';
import { DocumentChangeTracker } from './documentChangeTracker';
import { FileLifecycleTracker } from './fileLifecycleTracker';

let store: ReviewStore | undefined;
let persistence: ReviewStorePersistence | undefined;

export function activate(context: vscode.ExtensionContext) {
	persistence = new ReviewStorePersistence();
	store = new ReviewStore();
	store.setPersistence(persistence);
	context.subscriptions.push(store);
	context.subscriptions.push(persistence);

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

	// Phase 2: Decorations & gutter icons
	const decorationProvider = new DecorationProvider(store, context);
	context.subscriptions.push(decorationProvider);

	// Phase 2c: Navigate to thread on gutter click
	context.subscriptions.push(
		vscode.commands.registerCommand('ai-review.goToThread', (filePath: string, lineNumber: number) => {
			const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!workspaceUri) { return; }
			const uri = vscode.Uri.joinPath(workspaceUri, filePath);
			vscode.window.showTextDocument(uri, {
				selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),  // store 1-indexed → VS Code 0-indexed
				preserveFocus: false,
			});
		})
	);

	// Phase 3: Hover provider & comment creation commands
	const hoverProvider = new ReviewHoverProvider(store);
	context.subscriptions.push(hoverProvider);

	// Phase 4: CommentController for inline threaded UI
	const commentController = new ReviewCommentController(store);
	context.subscriptions.push(commentController);

	// Initialize persistence, then load data into store and sync comment threads
	if (workspaceFolder) {
		persistence.initialize(workspaceFolder).then(data => {
			store!.loadData(data);
			commentController.syncFromStore();
		}).catch((err) => { console.warn('AI Review: Failed to initialize store', err); });

		// Handle external file changes (e.g. another editor modifying .ai-review.json)
		persistence.onExternalChange(data => {
			store!.loadData(data);
		});
	}

	// Phase 3 + 4 commands (add, reply, resolve, unresolve, delete)
	registerCommands(context, store, () => commentController.syncFromStore());

	// Phase 6c: Track document changes to keep line numbers in sync
	const changeTracker = new DocumentChangeTracker(store);
	context.subscriptions.push(changeTracker);
	const fileLifecycleTracker = new FileLifecycleTracker(store);
	context.subscriptions.push(fileLifecycleTracker);

	console.log('AI Changes Review extension is now active');
}

export function deactivate() {
	store = undefined;
	persistence = undefined;
}

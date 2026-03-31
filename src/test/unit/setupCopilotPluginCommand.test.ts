import * as assert from 'assert';
import { registerSetupCopilotPluginCommand } from '../../setupCopilotPluginCommand';

/* eslint-disable @typescript-eslint/no-require-imports */
const mockVscode = require('vscode') as any;

suite('setupCopilotPluginCommand', () => {
    let originalRegisterCommand: any;

    setup(() => {
        originalRegisterCommand = mockVscode.commands.registerCommand;
    });

    teardown(() => {
        mockVscode.commands.registerCommand = originalRegisterCommand;
    });

    test('exported function is callable', () => {
        assert.strictEqual(typeof registerSetupCopilotPluginCommand, 'function');
    });

    test('registers the ai-review.setupCopilotPlugin command', () => {
        let registeredCommand: string | undefined;
        mockVscode.commands.registerCommand = (command: string, _callback: any) => {
            registeredCommand = command;
            return { dispose: () => {} };
        };

        const subscriptions: any[] = [];
        const mockContext = { subscriptions } as any;

        registerSetupCopilotPluginCommand(mockContext);
        assert.strictEqual(registeredCommand, 'ai-review.setupCopilotPlugin');
    });

    test('pushes a disposable into context.subscriptions', () => {
        const subscriptions: any[] = [];
        const mockContext = { subscriptions } as any;

        registerSetupCopilotPluginCommand(mockContext);
        assert.strictEqual(subscriptions.length, 1);
        assert.ok(typeof subscriptions[0].dispose === 'function');
    });
});

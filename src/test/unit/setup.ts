/**
 * Mocha bootstrap: intercepts `require('vscode')` so compiled source
 * modules resolve to the lightweight mock instead of the real extension host.
 * Referenced via `--require out/test/unit/setup.js` in the test:unit script.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require('module');
const path = require('path');

const mockVscodePath = path.join(__dirname, 'mocks', 'vscode');
const mockExports = require(mockVscodePath);

// Patch Module.prototype.require to intercept bare 'vscode' specifier
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string, ...args: unknown[]) {
    if (id === 'vscode') {
        return mockExports;
    }
    return originalRequire.apply(this, [id, ...args]);
};


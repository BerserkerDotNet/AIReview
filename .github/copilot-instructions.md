# Copilot instructions — AI Changes Review repository

A focused reference for Copilot CLI / assistant sessions working on the AI Changes Review VS Code extension. This file gathers the repository's build/test commands, high-level architecture, and repo-specific conventions so future automated sessions can act reliably.

---

## 1) Build, test, and lint commands (exact)

Run from the repository root.

- Install deps: `npm ci`
- Type-check: `npm run check-types` (runs `tsc --noEmit`)
- Lint: `npm run lint` (runs `eslint src`)
- Build (type-check, lint, bundle): `npm run compile` (check-types → lint → `node esbuild.js`)
- Watch (dev): `npm run watch` (parallel watchers for esbuild/tsc)
- Package (production build for VSIX): `npm run package` (check-types → lint → `node esbuild.js --production`)
- Package VSIX locally: `npx @vscode/vsce package`
- Publish VSIX (CI/local): `npx @vscode/vsce publish -p "$VSCE_PAT"` (requires VSCE_PAT secret)

Tests:
- Run full test suite (integration tests in a real VS Code host): `npm test` (uses `vscode-test`)
- Compile tests only (fast): `npm run compile-tests` (outputs compiled JS to `out/`)

Run a single test file (fast, uses compiled JS):
1. `npm run compile-tests`
2. `npx mocha out/test/decoration.test.js` (or any compiled spec in `out/test/`)

Run a single test case (grep):
- `npx mocha -g "pattern" out/test/*.test.js`

Debug/Run extension in VS Code:
- Open this workspace in VS Code and press F5 to launch an "Extension Development Host" for manual testing and debugging.

Notes:
- `npm test` executes integration tests inside a VS Code test host (the authoritative integration path).
- If the VS Code test runner fails due to stale Code installer processes, stop CodeSetup processes via PowerShell: `Get-Process | Where-Object { $_.ProcessName -like 'CodeSetup*' } | Stop-Process -Id $_.Id -Force`.

---

## 2) High-level architecture (big picture)

This extension centers around an in-workspace sidecar JSON store and a thin UI layer that uses VS Code's native Comments panel.

Core components:

- src/reviewStore.ts — Single source of truth. Persists ReviewData to `.vscode/.ai-review.json`, exposes CRUD, emits `onDidChangeThreads`, and implements anchor adjustment logic: `adjustLineNumbers`, `remapThreadsForRename`, `removeThreadsForDeletedPath`.

- src/commentController.ts — Bridges ReviewStore ↔ VS Code CommentController (`commentController id: 'ai-review'`). Responsible for mapping threads to native comment threads and handling submit/reply/resolve/delete flows.

- src/documentChangeTracker.ts — Listens to `workspace.onDidChangeTextDocument`, computes per-change line deltas (bottom-to-top) and debounces updates before calling `reviewStore.adjustLineNumbers`.

- src/fileLifecycleTracker.ts — Hooks `onDidRenameFiles` and `onDidDeleteFiles` to remap/remove threads based on exact file or folder prefix matches.

- src/decorationProvider.ts — Gutter icon + optional background line decoration. Reacts to `aiReview.decorationBackgroundColor` and thread changes.

- src/hoverProvider.ts — Hover UI offering quick add/reply/resolve actions.

- src/commands.ts — Registers editor/context and comments menu commands (add/reply/resolve/unresolve/delete) and keyboard shortcut (`Ctrl+Shift+R` / `Cmd+Shift+R`).

- src/extension.ts — Activation bootstrap: initializes ReviewStore, providers, trackers, and synchronizes store → CommentController.

Packaging & tooling:
- esbuild bundling configured via `esbuild.js`; output: `dist/extension.js`.
- Tests use `@vscode/test-*` harness and compiled unit tests in `out/test/` for fast mocha runs.
- CI workflow: `.github/workflows/build-vsix.yml` builds, tests, packages VSIX, uploads artifacts, and can publish a GitHub Release on tagged pushes.

---

## 3) Key conventions and repo-specific rules

- Sidecar file: `.vscode/.ai-review.json` (workspace folder). This is the primary, authoritative storage and is listed in `.gitignore` by default.

- Data indexing: `ReviewThread.lineNumber` is 1-indexed in the model (line 1 = first line of the file). VS Code's API is 0-indexed, so the extension converts at boundaries.

- CommentController id: `ai-review`. All `when` clauses in package.json menus/keybindings rely on this exact id (e.g., `commentController == ai-review`).

- Auto-save behavior: `aiReview.autoSave` (boolean, default `true`) controls whether the store is written to disk after each change; when `false` changes are not persisted automatically.

- Line-drift algorithm: Changes are processed bottom-to-top; delta = newlineCount(change.text) - (range.end.line - range.start.line); threads with lines > changeStart are shifted by delta; deleted anchored lines are clamped to the change start. Document edits are debounced before persistence (see DocumentChangeTracker debounce value).

- File rename/delete handling: Renames remap thread.filePath for file or folder-prefix matches; deletes remove threads under the deleted path.

- Comment body compatibility: Comment bodies may include `REVIEW:` and `LLM:` prefixes to remain compatible with the feedback-resolver skill's grep-based discovery.

- Packaging: The repo uses `npm run package` and `npx @vscode/vsce package` for VSIX creation; CI publishing to the VS Code Marketplace requires a publisher ID set in package.json and a `VSCE_PAT` secret in GitHub.

- Scripts: package.json exposes these important scripts (see exact values in package.json): `compile`, `package`, `compile-tests`, `test`, `watch`, `lint`, `check-types`.

---

## 4) Storage schema (reference)

The canonical sidecar is `.vscode/.ai-review.json`. At a high level the shape is:

{
  "threads": [
    {
      "id": "string",
      "filePath": "path/to/file",
      "lineNumber": 123,        // 1-indexed (line 1 = first line)
      "state": "unresolved" | "resolved",
      "comments": [
        {
          "id": "string",
          "author": "name",
          "body": "string",
          "createdAt": "ISO-8601",
          "editedAt": "ISO-8601?"
        }
      ],
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}

(See `src/models.ts` for the canonical TypeScript interfaces.)

---

## 5) Where to look for common edits and fast entry points

- To add a new command/menu: `src/commands.ts` + update `package.json` `contributes.commands` / `contributes.menus`.
- To change persistence/format: `src/reviewStore.ts` + `src/models.ts`.
- To adjust anchor-tracking behavior: `src/documentChangeTracker.ts` + corresponding unit tests under `src/test/`.
- To modify the Comments UI mapping: `src/commentController.ts` and `src/extension.ts` (ensure `syncFromStore()` is called after store init).
- To change bundling: `esbuild.js` and `package.json` `compile`/`package` scripts.

---

## 6) Copilot skill / plugin / marketplace notes

- Skill (resolve-comments): `.github/plugins/feedback-resolver/skills/resolve-comments/SKILL.md`
- Sidecar script: `.github/plugins/feedback-resolver/skills/resolve-comments/sidecar.ps1`
- Plugin manifest: `.github/plugins/feedback-resolver/plugin.json`
- Marketplace catalog: `.github/plugin/marketplace.json` (must include `name`, `owner`, and plugins[].name in kebab-case and valid `source` paths)

These files are present and used for local Copilot plugin testing and for publishing the plugin catalog.

---

## 7) Other AI assistant configs

A scan of the repository found no additional assistant rule files (CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules, CONVENTIONS.md, .clinerules, AIDER_CONVENTIONS.md).

---

Would you like me to configure any MCP servers (e.g., Playwright) for CI test types or add directives for a specific MCP server?

Summary: updated .github/copilot-instructions.md with exact scripts, run/debug steps, architecture, key conventions, and a reference storage schema. Would you like adjustments or extra coverage for any specific areas (packaging, marketplace metadata, or testing)?

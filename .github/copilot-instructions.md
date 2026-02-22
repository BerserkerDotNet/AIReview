# Copilot instructions — AI Changes Review repository

Purpose: help future Copilot CLI / assistant sessions quickly understand how to build, test, run, and modify this VS Code extension repository.

---

## 1) Build, test, and lint commands

Primary commands (run from repository root):

- Install deps: `npm ci`
- Build (type-check, lint, bundle): `npm run compile`
- Lint: `npm run lint`
- Run all tests (integration tests in VS Code test host): `npm test`
- Compile tests only: `npm run compile-tests` (outputs JS to `out/test/`)
- Package VSIX locally: `npx @vscode/vsce package` or `npm run package`
- Create VSIX and publish (CI/local): `npx @vscode/vsce publish -p "$VSCE_PAT"` (requires PAT in env/secret)
- Watch (dev): `npm run watch` (runs parallel watchers)

Run a single test file (fast, uses compiled JS):

1. `npm run compile-tests`
2. Run mocha on a single compiled file, e.g.: `npx mocha out/test/decoration.test.js`

Run a single test case (grep):

- `npx mocha -g "pattern" out/test/*.test.js` or temporarily use `it.only(...)` / `test.only(...)` in the TypeScript source and re-run `npm run compile-tests && npx mocha out/test/*.test.js`.

Notes about tests:
- The canonical full test run uses the `vscode-test` harness (the `npm test` script) which launches a VS Code extension host; that is the authoritative integration test path.
- If the VS Code test runner fails with "Code is currently being updated" or similar, stop lingering CodeSetup processes (PowerShell: `Get-Process | Where-Object { $_.ProcessName -like 'CodeSetup*' } | Stop-Process -Id $_.Id -Force`) and retry.

---

## 2) High-level architecture (big picture)

- src/reviewStore.ts — Core persistence and model management (ReviewData -> `.vscode/.ai-review.json`). Implements CRUD, event emitter `onDidChangeThreads`, line-shift logic (`adjustLineNumbers`), rename/delete remapping (`remapThreadsForRename` / `removeThreadsForDeletedPath`). This is the single source of truth consumers read from.

- src/commentController.ts — Wraps VS Code `comments.createCommentController('ai-review', ...)`. Syncs store -> native Comments panel threads and handles submit/reply/resolve/delete actions.

- src/decorationProvider.ts — Gutter icon + line highlight decorations; respects configuration `aiReview.decorationBackgroundColor` and refreshes on thread changes.

- src/hoverProvider.ts — Provides hover contents (add/reply links) above review lines.

- src/commands.ts — Central registration for user-facing commands (addComment, replyToThread, resolveThread, unresolveThread, deleteThread) and wiring to quick input dialogs.

- src/documentChangeTracker.ts — Listens to `workspace.onDidChangeTextDocument`, computes line deltas and calls `reviewStore.adjustLineNumbers` (debounced). Critical for keeping anchors in sync during edits.

- src/fileLifecycleTracker.ts — Listens to file rename/delete events (`onDidRenameFiles` / `onDidDeleteFiles`) and remaps or removes threads in the store.

- src/extension.ts — Entry point: initializes ReviewStore, providers, trackers, register commands and bootstraps sync into the native Comments panel.

- resources/ — Static assets (gutter icon `comment.svg`, extension icon `resources/icon.png`).

- dist/ — Bundled extension output from esbuild (used by the packaged VSIX).

- .github/ — CI workflows, Copilot plugin marketplace and plugin skeletons (feedback-resolver skill + marketplace manifest).

---

## 3) Key conventions and repo-specific rules

- Sidecar storage: the extension stores threads at `.vscode/.ai-review.json` (workspace folder). This file is ignored by default via `.gitignore`.

- Thread indexing: `ReviewThread.lineNumber` is stored zero-indexed internally; UI displays are 1-indexed.

- CommentController identity: the comment controller is created with id `ai-review` (see `createCommentController('ai-review', ...)`). Menu `when` clauses in `package.json` rely on this id; keep it in sync if you rename the controller id.

- `aiReview.autoSave` controls persistence: when `true` (default), changes are written to the sidecar automatically; when `false`, code path currently avoids writing the file.

- Build/bundle: esbuild is used (see `esbuild.js`) and compiled output goes to `dist/extension.js`. Use `npm run compile` for a production build.

- Tests: Integration tests run inside a real VS Code test host (`vscode-test`). Unit-style tests are compiled to `out/test/*.js` and can be executed with `npx mocha` for targeted runs.

- Tasks: `.vscode/tasks.json` includes a custom background problem matcher for esbuild watch output; this avoids invalid `$esbuild-watch` references.

- Publishing: CI workflow `.github/workflows/build-vsix.yml` packages the VSIX and (on `v*` tags) publishes to GitHub Releases; see plan.md for steps to publish to the Visual Studio Marketplace (requires a PAT set as `VSCE_PAT`).

- Copilot plugin marketplace: plugin source lives under `.github/plugins/feedback-resolver`; the repository-level marketplace manifest is at `.github/plugin/marketplace.json` — plugin names must be kebab-case and `source` paths are relative.

- Replacements/overrides: package.json uses `overrides` to pin known transitive packages (`diff`, `glob`, `minimatch`) to secure versions.

- Comment body prefixes: `REVIEW:` and `LLM:` prefixes are supported for compatibility with the older review-resolver grep-based workflows but are optional; the JSON sidecar is the source of truth.

---

## 4) Where to look for common edits

- Add a new command/menu: update `src/commands.ts` + `package.json` `contributes.menus` and `contributes.commands` (ensure the command id matches the handler).

- Add a UI change to inline comments: modify `src/commentController.ts` and ensure `syncFromStore()` maps to the native `CommentController` API.

- Change persistence behavior: update `src/reviewStore.ts` (save/load) and be careful with `FileSystemWatcher` re-entrancy.

- Update CI packaging/publishing: modify `.github/workflows/build-vsix.yml` and add `VSCE_PAT` secret to repository settings for Marketplace publishes.

---

## 5) Files that are intentionally not authoritative

- `src/test/*` are test assets and may set up temporary workspaces; they should be consulted for behavior but not treated as canonical API docs.

---

## 6) Quick troubleshooting

- If `vscode-test` fails with update/mutex errors, stop stale CodeSetup processes or reboot the machine; the test harness expects a stable Code installer state.
- If the extension's comments do not appear in the Comments panel, ensure `commentController.syncFromStore()` is being called after `ReviewStore.initialize()` — see `src/extension.ts`.

---

Would you like me to also configure any MCP servers (e.g., Playwright) for CI test types or add directives for a specific MCP server? 


*Created .github/copilot-instructions.md with the above guidance.*

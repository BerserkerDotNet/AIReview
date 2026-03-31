# Changelog

All notable changes to the **AI Changes Review** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — Maintainability, Performance & Test Coverage

### Added
- **Status bar thread counter** — shows `💬 N open · ✅ M` in the status bar; click to open Comments panel; hides when no threads exist
- **Next/Previous thread navigation** — `Alt+F2` / `Alt+Shift+F2` to jump between open review threads within and across files
- **Resolve thread at line** keybinding — `Ctrl+Shift+E` (`Cmd+Shift+E` on Mac) to instantly resolve the thread at the cursor without a picker
- **Structured logging** — all extension output now routes through a dedicated `AI Changes Review` Output Channel instead of the console
- **Cross-platform path normalization** — thread paths are consistently stored with forward slashes, fixing potential mismatches on Windows

### Changed
- **Decomposed large modules** for maintainability:
  - `reviewStore.ts` (279→192 lines) — extracted `threadAnchorService.ts`, `threadPathService.ts`, `events.ts`
  - `commands.ts` (294→206 lines) — extracted `commandUtils.ts`, `setupCopilotPluginCommand.ts`, `threadNavigation.ts`
  - `commentController.ts` — extracted command handlers to `commentCommands.ts`; refactored `syncFromStore` to a clean switch dispatch with focused private methods
- **Performance optimizations**:
  - `Map<filePath, threads[]>` index in ReviewStore — file-based queries are now O(1) instead of O(n)
  - Scoped `syncFromStore` with `ThreadChangeEvent` — single-thread mutations update only the affected thread, not the entire list
  - Scoped decoration refresh — only editors showing the affected file are repainted
  - HoverProvider early-exit for files with zero threads
- **Persistence race condition fixed** — replaced fragile `setTimeout`-based write flag with a generation counter that correctly handles slow saves and rapid successive writes
- **Stricter TypeScript** — enabled `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedParameters`
- **Consolidated persistence interfaces** — removed duplicate `IPersistence`; single `IReviewStorePersistence` interface
- **Improved variable naming** — replaced short names (`reg`, `fn`, `arr`, `cid`, `d`) with descriptive names across the codebase
- **Updated gutter icon** — replaced solid green comment bubble with a neutral outline style matching VS Code's native codicon aesthetic

### Removed
- Unused `sinon` / `@types/sinon` dev dependencies

### Tests
- **Unit tests**: 24 → 201 (+177) — new suites for commands, commentController, hoverProvider, documentChangeTracker, events, threadNavigation, logger, statusBarProvider, and edge cases
- **Integration tests**: 142 → 160 (+18) — scoped sync events, persistence edge cases, navigation commands, path normalization
- **Performance regression tests** — canary suite with 1,000 threads verifying O(1) lookups

---

## [1.0.1] — Dependency Updates

### Changed
- Updated npm dev dependencies: `@types/node` 25.5, `esbuild` 0.27.4, `eslint` 10.1, `typescript-eslint` 8.57
- Updated `minimatch` override to ^10.2.2
- CI workflow: upgraded GitHub Actions (`checkout`, `setup-node`, `upload-artifact`, `download-artifact`) from v4 to v6
- CI workflow: upgraded Node.js from 20 to 22 LTS

---

## [1.0.0] — First Public Release

### Added
- **Comment editing** — edit the body of any existing comment in a thread
- **ReviewStorePersistence** — watches `.vscode/.ai-review.json` for external changes and reloads automatically, enabling multi-tool workflows
- **Companion Copilot `resolve-comments` skill** with `sidecar.ps1` script for automated thread resolution
- **Setup Copilot Plugin** command and walkthrough to guide first-time configuration of the Copilot skill
- Integration and unit test suite (`@vscode/test-electron` + Mocha)
- CI/CD workflow (`.github/workflows/build-vsix.yml`) with automated VSIX packaging, artifact upload, and GitHub Releases on tagged pushes
- Copilot instructions (`.github/copilot-instructions.md`) for AI-assisted development

### Changed
- Renamed extension from "AI Review" to **AI Changes Review** and updated all related identifiers
- Improved line-number anchor tracking — edits that span multiple lines now shift thread anchors more accurately
- Updated paths and configuration to use `.vscode/.ai-review.json` consistently across feedback-resolver plugin and marketplace metadata
- Marketplace and plugin configurations refactored for the `feedback-resolver` skill
- Test cases updated to use `path.join` for cross-platform compatibility and improved cleanup in integration tests

### Fixed
- CI workflow branch reference corrected from `main` to `master`
- Miscellaneous path fixes in build and plugin configuration

---

## [0.0.1]

### Added
- Add review comments via hover, right-click context menu, or `Ctrl+Shift+R`
- Inline threaded conversations using VS Code CommentController API
- Native VS Code Comments panel integration (no custom sidebar panel required)
- Resolve / unresolve threads
- Delete threads
- Gutter icons and line highlighting for lines with active review threads
- `.vscode/.ai-review.json` sidecar storage with full JSON schema
- Automatic anchor tracking for line edits, file/folder renames, and file/folder deletes
- Multi-turn comment threads (user + AI replies)

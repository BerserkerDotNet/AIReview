# Changelog

All notable changes to the **AI Changes Review** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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

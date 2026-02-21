# AI Changes Review

A VS Code extension for placing and managing `REVIEW:` comments in code for AI-assisted code review.

## Features

- **💬 Add review comments** — Hover over any line and click "Add Review Comment", right-click in the editor, or press `Ctrl+Shift+R` (`Cmd+Shift+R` on Mac)
- **🧵 Threaded inline conversations** — Multi-turn comment threads inline in the editor, like GitHub PR reviews
- **✅ Resolve/Unresolve threads** — Mark threads as resolved when addressed
- **📋 Comments panel** — VS Code's native Comments panel (View → Comments) lists all threads grouped by file with built-in open/resolved filtering
- **🗂️ Persistent storage** — All threads saved to `.vscode/.ai-review.json`
- **📐 Anchor tracking** — Thread anchors stay in sync on line edits, file/folder renames, and file/folder deletes

## Usage

### Adding a comment

1. Hover over a line and click **💬 Add Review Comment**
2. Or right-click → **AI Changes Review: Add Review Comment**
3. Or press `Ctrl+Shift+R`
4. Type your comment and press Enter

### Replying to a thread

Click on the thread widget inline in the editor and type a reply.

### Resolving a thread

Click the **Resolve Thread** button (✅) in the thread title bar in the editor.

### Viewing all threads

Open the native **Comments** panel (View → Comments, or the speech-bubble icon in the bottom panel toolbar) to see all threads grouped by file. VS Code's built-in filter toggle shows open vs resolved threads.

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiReview.decorationBackgroundColor` | `""` | Custom background color for review lines (e.g. `#ffff0020`) |
| `aiReview.autoSave` | `true` | Auto-save `.vscode/.ai-review.json` after every change; when `false`, changes are session-only until you re-enable auto-save |

## Storage Format

Review threads are stored in `.vscode/.ai-review.json`. This path is included in `.gitignore` by default.

## Compatibility with review-resolver skill

Comment bodies can use `REVIEW:` and `LLM:` prefixes to stay compatible with the review-resolver Copilot skill, which uses `grep -rn "REVIEW:"` to discover comments.

## Copilot skill plugin + marketplace

- Skill: `.github/plugins/feedback-resolver/skills/feedback-resolver/SKILL.md`
- Plugin manifest: `.github/plugins/feedback-resolver/plugin.json`
- Marketplace catalog: `.github/plugin/marketplace.json`

The `feedback-resolver` skill resolves open threads from `.vscode/.ai-review.json`, appends `llm` comments, and marks processed threads as `resolved`.

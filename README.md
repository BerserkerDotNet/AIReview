# AI Changes Review

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/BerserkerDotNet.ai-changes-review)](https://marketplace.visualstudio.com/items?itemName=BerserkerDotNet.ai-changes-review)
[![Build Status](https://github.com/BerserkerDotNet/AIReview/actions/workflows/build-vsix.yml/badge.svg)](https://github.com/BerserkerDotNet/AIReview/actions/workflows/build-vsix.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## 🤖 Companion Copilot Skill

This extension ships with a companion **Copilot CLI skill** called `resolve-comments` that can automatically resolve your review threads using AI.

### What it does

The `resolve-comments` skill reads your open review threads from `.vscode/.ai-review.json`, analyzes the code context, implements fixes, and marks threads as resolved — all through Copilot.

### Install the skill

You can install the companion skill directly from the Copilot CLI:

1. **Add the marketplace catalog:**
   ```
   /plugin marketplace add BerserkerDotNet/AIReview
   ```
2. **Install the plugin:**
   ```
   /plugin install feedback-resolver@ai-changes-review-marketplace
   ```

Or use the command palette: **AI Changes Review: Setup Copilot Plugin** for guided installation.

### How to use

Once installed, ask Copilot to resolve your review threads:
- "Resolve my open review comments"
- "Process unresolved AI review threads"
- Use the `resolve-comments` skill directly

The skill will systematically work through each open thread, make code changes, add reply comments documenting what was changed, and mark threads as resolved.

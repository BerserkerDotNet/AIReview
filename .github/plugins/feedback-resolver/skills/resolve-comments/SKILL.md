---
name: resolve-comments
description: 'Resolves open threads from .vscode/.ai-review.json by implementing fixes, replying in-thread, and marking threads resolved.'
---

# Feedback Resolver

Systematically resolves open threads stored in `.vscode/.ai-review.json`.

## When to Use

- User asks to resolve AI review threads
- User asks to process unresolved review comments from sidecar storage
- User asks to apply feedback tracked by the AI Changes Review extension

## Sidecar Script

All read/write operations on `.vscode/.ai-review.json` go through `sidecar.ps1` — a cross-platform PowerShell script shipped next to this file. Prefer using the script for all operations; only edit the JSON file by hand as a fallback if the script is unavailable.

### Locating the script

The script is `sidecar.ps1` in the same directory as this SKILL.md:

```powershell
$scriptPath = Join-Path $PSScriptRoot 'sidecar.ps1'
if (-not (Test-Path $scriptPath)) {
    $scriptPath = Get-ChildItem -Path .github -Filter sidecar.ps1 -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $scriptPath -or -not (Test-Path $scriptPath)) { Write-Error "Cannot find sidecar.ps1"; return }
```

### Data model

- **Thread status**: `"open"` or `"resolved"`
- **Comment author**: `"user"` or `"llm"`
- **`lineNumber`**: **1-indexed** — use directly, no offset needed
- **Timestamps**: ISO 8601 UTC
- All output is JSON to stdout; errors return `{ "error": "..." }` with exit code 1

### Available actions

**find_active** — List open threads (full thread objects)
```powershell
& $scriptPath -Action find_active
```
Returns: JSON array of full thread objects where `status == "open"`.

**get_thread** — Full thread details
```powershell
& $scriptPath -Action get_thread -ThreadId "<id>"
```

**resolve** — Mark thread resolved
```powershell
& $scriptPath -Action resolve -ThreadId "<id>"
```

**reopen** — Reopen a thread
```powershell
& $scriptPath -Action reopen -ThreadId "<id>"
```

**reply** — Add a comment
```powershell
& $scriptPath -Action reply -ThreadId "<id>" -Body '<text>' -Author llm
```
`-Author` defaults to `llm`. Auto-generates comment `id` and `timestamp`.

**clear_resolved** — Remove all resolved threads ⚠️ destructive, confirm first
```powershell
& $scriptPath -Action clear_resolved
```

**delete** — Remove a single thread ⚠️ destructive, confirm first
```powershell
& $scriptPath -Action delete -ThreadId "<id>"
```

**list_by_file** — Threads for a specific file
```powershell
& $scriptPath -Action list_by_file -FilePath "<relative-path>"
```

All actions accept optional `-SidecarPath <path>` to override the default `.vscode/.ai-review.json`.

## Workflow

### 1. Discover open threads

Run `find_active`. It returns full thread objects for all open threads. If the result is an empty array, stop and tell the user there are no tracked threads to resolve.

### 2. Read code context

For each open thread, open its target file and inspect context around `lineNumber`. **`lineNumber` is 1-indexed** — line 1 is the first line of the file. Use `get_thread` if you need to refresh a single thread's details.

### 3. Clarify if ambiguous

**CRITICAL:** Use `ask_user` when a thread requires product decisions, unclear intent, or multiple valid implementations.

### 4. Implement and record resolution

For each open thread:
1. Make the code change (or explain why no change is needed)
2. Run `reply` to document what was changed (`-Author llm`, `-Body` summarising the change)
3. Run `resolve` to mark it resolved

### 5. Validate

Run project checks/tests that already exist and fix issues caused by the change.

### 6. Final verification

- Run `find_active` to confirm no targeted threads remain open
- Confirm tests/build pass

## Rules

✅ **Do:**
- Make minimal focused changes
- Resolve one thread at a time
- Use `sidecar.ps1` for all data operations
- Ask clarifying questions when needed

❌ **Don't:**
- Skip adding a reply comment before resolving
- Resolve ambiguous threads without confirmation
- Make unrelated refactors
- Edit `.vscode/.ai-review.json` directly

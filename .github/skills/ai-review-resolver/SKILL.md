---
name: ai-review-resolver
description: 'Resolves open threads from .ai-review.json by implementing fixes, replying in-thread, and marking threads resolved.'
---

# AI Review Resolver

Systematically resolves open threads stored in `.ai-review.json`.

## When to Use

- User asks to resolve AI review threads
- User asks to process unresolved review comments from sidecar storage
- User asks to apply feedback tracked by the AI Review extension

## Workflow

### 1. Discover sidecar files
```powershell
Get-ChildItem -Path . -Filter .ai-review.json -Recurse -File
```

If no sidecar exists, stop and tell the user there are no tracked threads yet.

### 2. Parse open threads
Read `.ai-review.json` and select `threads` where `status == "open"`.

Minimum fields to extract per thread:
- `id`
- `filePath`
- `lineNumber`
- latest comment body

### 3. Read code context
Open each thread target file and inspect context around `lineNumber`.

### 4. Clarify if ambiguous
**CRITICAL:** Use `ask_user` when a thread requires product decisions, unclear intent, or multiple valid implementations.

### 5. Implement and record resolution

For each open thread:
1. Make the code change (or explain why no change is needed)
2. Append a new comment in the thread:
   - `author: "llm"`
   - `body`: summary of what was changed (or rationale)
   - `timestamp`: ISO 8601 UTC
3. Set thread `status` to `"resolved"`

### 6. Validate
Run project checks/tests that already exist and fix issues caused by the change.

### 7. Persist sidecar update
Write back `.ai-review.json` with resolved status and appended `llm` comments.

### 8. Final verification
- Confirm no unresolved targeted threads remain
- Confirm tests/build pass

## Rules

✅ **Do:**
- Make minimal focused changes
- Resolve one thread at a time
- Keep `.ai-review.json` as source of truth
- Ask clarifying questions when needed

❌ **Don't:**
- Skip updating thread status/comments
- Resolve ambiguous threads without confirmation
- Make unrelated refactors

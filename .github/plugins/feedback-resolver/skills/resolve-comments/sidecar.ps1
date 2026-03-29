#!/usr/bin/env pwsh
# sidecar.ps1 — CLI for .vscode/.ai-review.json sidecar file
# Works on PowerShell Core 7+ (Windows, Mac, Linux)

param(
    [Parameter(Mandatory)]
    [ValidateSet('find_active', 'get_thread', 'resolve', 'reopen', 'reply', 'clear_resolved', 'delete', 'list_by_file')]
    [string]$Action,

    [string]$ThreadId,
    [string]$FilePath,
    [string]$Author = 'llm',
    [string]$Body,
    [string]$SidecarPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Helpers ---------------------------------------------------------------

function Write-JsonOutput {
    param([object]$Data)
    if ($Data -is [System.Array] -and $Data.Count -eq 0) {
        Write-Output '[]'
        return
    }
    $Data | ConvertTo-Json -Depth 10 -Compress | Write-Output
}

function Write-ErrorJson {
    param([string]$Message)
    @{ error = $Message } | ConvertTo-Json -Depth 10 -Compress | Write-Output
    exit 1
}

function Read-Sidecar {
    param([string]$Path)
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return ($raw | ConvertFrom-Json)
}

function Write-Sidecar {
    param([string]$Path, [object]$Data)
    $json = $Data | ConvertTo-Json -Depth 10
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Find-Thread {
    param([object]$ReviewData, [string]$Id)
    foreach ($t in $ReviewData.threads) {
        if ($t.id -eq $Id) { return $t }
    }
    return $null
}

function Assert-SidecarExists {
    if (-not [System.IO.File]::Exists($script:SidecarPath)) {
        Write-ErrorJson "Sidecar file not found: $script:SidecarPath"
    }
}

function Assert-ThreadId {
    param([string]$ActionName)
    if (-not $script:ThreadId) { Write-ErrorJson "$ActionName requires -ThreadId" }
}

# --- Action functions ------------------------------------------------------

function Invoke-FindActive {
    if (-not [System.IO.File]::Exists($SidecarPath)) {
        Write-JsonOutput @()
        exit 0
    }
    $data = Read-Sidecar $SidecarPath
    $results = @($data.threads | Where-Object { $_.status -eq 'open' })
    Write-JsonOutput $results
}

function Invoke-GetThread {
    Assert-ThreadId 'get_thread'
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $thread = Find-Thread $data $ThreadId
    if (-not $thread) { Write-ErrorJson "Thread not found: $ThreadId" }
    Write-JsonOutput $thread
}

function Invoke-Resolve {
    Assert-ThreadId 'resolve'
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $thread = Find-Thread $data $ThreadId
    if (-not $thread) { Write-ErrorJson "Thread not found: $ThreadId" }
    $thread.status = 'resolved'
    Write-Sidecar $SidecarPath $data
    Write-JsonOutput $thread
}

function Invoke-Reopen {
    Assert-ThreadId 'reopen'
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $thread = Find-Thread $data $ThreadId
    if (-not $thread) { Write-ErrorJson "Thread not found: $ThreadId" }
    $thread.status = 'open'
    Write-Sidecar $SidecarPath $data
    Write-JsonOutput $thread
}

function Invoke-Reply {
    Assert-ThreadId 'reply'
    if (-not $Body) { Write-ErrorJson "reply requires -Body" }
    if ($Author -notin @('user', 'llm')) {
        Write-ErrorJson "Author must be 'user' or 'llm', got: $Author"
    }
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $thread = Find-Thread $data $ThreadId
    if (-not $thread) { Write-ErrorJson "Thread not found: $ThreadId" }

    $comment = @{
        id        = [guid]::NewGuid().ToString()
        author    = $Author
        body      = $Body
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    }

    $thread.comments = @(@($thread.comments) + $comment)
    Write-Sidecar $SidecarPath $data
    Write-JsonOutput $comment
}

function Invoke-ClearResolved {
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $before = @($data.threads).Count
    $data.threads = @($data.threads | Where-Object { $_.status -ne 'resolved' })
    $removed = $before - @($data.threads).Count
    Write-Sidecar $SidecarPath $data
    Write-JsonOutput @{ removed = $removed }
}

function Invoke-Delete {
    Assert-ThreadId 'delete'
    Assert-SidecarExists
    $data = Read-Sidecar $SidecarPath
    $thread = Find-Thread $data $ThreadId
    if (-not $thread) { Write-ErrorJson "Thread not found: $ThreadId" }
    $data.threads = @($data.threads | Where-Object { $_.id -ne $ThreadId })
    Write-Sidecar $SidecarPath $data
    Write-JsonOutput @{ deleted = $true; id = $ThreadId }
}

function Invoke-ListByFile {
    if (-not $FilePath) { Write-ErrorJson "list_by_file requires -FilePath" }
    if (-not [System.IO.File]::Exists($SidecarPath)) {
        Write-JsonOutput @()
        exit 0
    }
    $data = Read-Sidecar $SidecarPath
    $results = @($data.threads | Where-Object { $_.filePath -eq $FilePath })
    Write-JsonOutput $results
}

# --- Resolve sidecar path -------------------------------------------------

if (-not $SidecarPath) {
    $SidecarPath = [System.IO.Path]::Combine((Get-Location).Path, '.vscode', '.ai-review.json')
}

# --- Action dispatch -------------------------------------------------------

try {
    switch ($Action) {
        'find_active'    { Invoke-FindActive }
        'get_thread'     { Invoke-GetThread }
        'resolve'        { Invoke-Resolve }
        'reopen'         { Invoke-Reopen }
        'reply'          { Invoke-Reply }
        'clear_resolved' { Invoke-ClearResolved }
        'delete'         { Invoke-Delete }
        'list_by_file'   { Invoke-ListByFile }
    }
}
catch {
    Write-ErrorJson $_.Exception.Message
}

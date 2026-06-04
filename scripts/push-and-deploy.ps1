[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$WhatChanged,

    [int]$ChangeNumber,

    [ValidateSet('auto', 'all', 'no-build')]
    [string]$DeployMode = 'auto',

    [string]$Branch = 'main',

    [string]$RemoteHost = '159.89.40.84',

    [string]$RemoteUser = 'root',

    [string]$RemotePath = '/opt/waraqa',

    [string]$SshKeyPath,

    [switch]$SkipLocalBuild,

    [switch]$SkipBackendSyntaxCheck,

    [switch]$AllowEmptyCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "[deploy] $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "[deploy] $Message" -ForegroundColor Yellow
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @(),

        [string]$FailureMessage = 'Command failed.'
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

function Get-CommandOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @(),

        [string]$FailureMessage = 'Command failed.'
    )

    $output = & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }

    if ($output -is [System.Array]) {
        return ($output -join "`n").Trim()
    }

    return [string]$output
}

function ConvertTo-BashLiteral {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) {
        return "''"
    }

    $singleQuoteEscape = [string]::Concat("'", '"', "'", '"', "'")
    return "'" + ($Value -replace "'", $singleQuoteEscape) + "'"
}

function Get-NextDeployNumber {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CounterFile,

        [int]$RequestedNumber
    )

    if ($PSBoundParameters.ContainsKey('RequestedNumber') -and $RequestedNumber -gt 0) {
        return $RequestedNumber
    }

    if (Test-Path $CounterFile) {
        $raw = (Get-Content -Path $CounterFile -Raw).Trim()
        if ($raw -match '^[0-9]+$') {
            return ([int]$raw + 1)
        }
    }

    return 1
}

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')

Push-Location $repoRoot
try {
    Assert-Command git
    Assert-Command ssh
    Assert-Command node
    if (-not $SkipLocalBuild) {
        Assert-Command npm
    }

    if ($SshKeyPath) {
        $resolvedKey = Resolve-Path $SshKeyPath -ErrorAction Stop
        $SshKeyPath = $resolvedKey.Path
    }

    $gitTopLevel = Get-CommandOutput -FilePath git -Arguments @('rev-parse', '--show-toplevel') -FailureMessage 'Failed to resolve repository root.'
    if ((Resolve-Path $gitTopLevel).Path -ne $repoRoot.Path) {
        throw "This script must run from the Waraqa repository. Expected $($repoRoot.Path), got $gitTopLevel"
    }

    $gitDir = Resolve-Path (Get-CommandOutput -FilePath git -Arguments @('rev-parse', '--git-dir') -FailureMessage 'Failed to resolve .git directory.')
    $counterFile = Join-Path $gitDir.Path 'waraqa-deploy-counter.txt'
    $historyFile = Join-Path $gitDir.Path 'waraqa-deploy-history.log'
    $commitMessageFile = Join-Path $gitDir.Path 'waraqa-deploy-commit-message.txt'

    $buildTimeUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $displayTimestamp = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'
    $deployNumber = Get-NextDeployNumber -CounterFile $counterFile -RequestedNumber $ChangeNumber
    $safeSummary = ($WhatChanged -replace '\s+', ' ').Trim()

    if (-not $safeSummary) {
        throw 'WhatChanged cannot be empty.'
    }

    Write-Step "Preparing deploy #$deployNumber"
    Write-Step "Summary: $safeSummary"
    Write-Step "Timestamp: $displayTimestamp"

    $statusBefore = Get-CommandOutput -FilePath git -Arguments @('status', '--short') -FailureMessage 'Failed to read git status.'
    if (-not $statusBefore -and -not $AllowEmptyCommit) {
        throw 'No local changes detected. Add edits first, or rerun with -AllowEmptyCommit if you intentionally want to redeploy the current HEAD.'
    }

    Write-Step 'Staging all local edits'
    Invoke-CheckedCommand -FilePath git -Arguments @('add', '-A') -FailureMessage 'git add failed.'

    $stagedFilesRaw = Get-CommandOutput -FilePath git -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB') -FailureMessage 'Failed to list staged files.'
    $stagedFiles = @()
    if ($stagedFilesRaw) {
        $stagedFiles = $stagedFilesRaw -split "`r?`n" | Where-Object { $_.Trim() }
    }

    if (-not $stagedFiles.Count -and -not $AllowEmptyCommit) {
        throw 'Nothing is staged after git add -A. No deploy commit was created.'
    }

    if ($stagedFiles.Count) {
        Write-Step 'Files queued for deploy:'
        $stagedFiles | ForEach-Object { Write-Host "  - $_" }
    } else {
        Write-WarnLine 'Creating an empty deploy commit because -AllowEmptyCommit was used.'
    }

    if (-not $SkipBackendSyntaxCheck) {
        $backendCheckFiles = @($stagedFiles | Where-Object { $_ -match '^backend/.+\.(js|cjs|mjs)$' })
        if ($backendCheckFiles.Count) {
            Write-Step 'Running backend syntax checks on changed backend files'
            foreach ($file in $backendCheckFiles) {
                Invoke-CheckedCommand -FilePath node -Arguments @('--check', $file) -FailureMessage "Backend syntax check failed for $file"
            }
        }
    }

    if (-not $SkipLocalBuild) {
        Write-Step 'Building the frontend locally'
        Invoke-CheckedCommand -FilePath npm -Arguments @('--prefix', 'frontend', 'run', 'build') -FailureMessage 'Frontend build failed. Deployment stopped.'
    }

    $commitSubject = ('deploy #{0}: {1}' -f $deployNumber, $safeSummary)
    $commitBody = @(
        $commitSubject,
        '',
        "Change number: $deployNumber",
        "What changed: $safeSummary",
        "Created at (UTC): $buildTimeUtc",
        ''
    )

    if ($stagedFiles.Count) {
        $commitBody += 'Files:'
        $commitBody += ($stagedFiles | ForEach-Object { "- $_" })
    } else {
        $commitBody += 'Files:'
        $commitBody += '- (empty deploy commit)'
    }

    Set-Content -Path $commitMessageFile -Value $commitBody -Encoding UTF8

    Write-Step 'Creating the git commit'
    $commitArgs = @('commit', '-F', $commitMessageFile)
    if ($AllowEmptyCommit -and -not $stagedFiles.Count) {
        $commitArgs += '--allow-empty'
    }
    Invoke-CheckedCommand -FilePath git -Arguments $commitArgs -FailureMessage 'git commit failed.'

    $commitSha = Get-CommandOutput -FilePath git -Arguments @('rev-parse', 'HEAD') -FailureMessage 'Failed to read commit SHA.'

    Write-Step "Pushing HEAD to origin/$Branch"
    Invoke-CheckedCommand -FilePath git -Arguments @('push', 'origin', "HEAD:$Branch") -FailureMessage 'git push failed. Deployment stopped before touching the server.'

    $sshArguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')
    if ($SshKeyPath) {
        $sshArguments += @('-i', $SshKeyPath)
    }

    $targetRef = "origin/$Branch"
    $remoteCommandLines = @(
        'set -euo pipefail',
        ('cd {0}' -f (ConvertTo-BashLiteral $RemotePath)),
        ('export BUILD_VERSION={0}' -f (ConvertTo-BashLiteral ([string]$deployNumber))),
        ('export BUILD_TIME={0}' -f (ConvertTo-BashLiteral $buildTimeUtc)),
        ('export TARGET_REF={0}' -f (ConvertTo-BashLiteral $targetRef)),
        ('export DEPLOY_NOTE={0}' -f (ConvertTo-BashLiteral $safeSummary)),
        'echo "[deploy] remote host: $HOSTNAME"',
        ('echo "[deploy] change #{0}"' -f $deployNumber),
        'echo "[deploy] note: ${DEPLOY_NOTE}"',
        'chmod +x deploy/scripts/deploy.sh',
        ('./deploy/scripts/deploy.sh {0}' -f (ConvertTo-BashLiteral $DeployMode))
    )
    $remoteCommand = $remoteCommandLines -join '; '

    Write-Step 'Running the server deploy over SSH'
    Invoke-CheckedCommand -FilePath ssh -Arguments ($sshArguments + @("$RemoteUser@$RemoteHost", $remoteCommand)) -FailureMessage 'Remote deploy failed after push. The commit is already on the remote branch, but the server deploy did not finish successfully.'

    Set-Content -Path $counterFile -Value ([string]$deployNumber) -Encoding ASCII
    Add-Content -Path $historyFile -Value "$buildTimeUtc`t#$deployNumber`t$commitSha`t$safeSummary" -Encoding UTF8

    Write-Step 'Deployment completed successfully'
    Write-Host "[deploy] Commit: $commitSha" -ForegroundColor Green
    Write-Host "[deploy] Branch: origin/$Branch" -ForegroundColor Green
    Write-Host "[deploy] Deploy number: #$deployNumber" -ForegroundColor Green
}
finally {
    if (Test-Path $commitMessageFile) {
        Remove-Item $commitMessageFile -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
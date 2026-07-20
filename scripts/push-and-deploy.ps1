[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string]$WhatChanged,

	[int]$ChangeNumber,

	# 'pull' is the production model: deploy the CI-built GHCR image for this exact
	# commit (matches .github/workflows/deploy-droplet.yml). The local-build modes
	# ('auto'/'all'/'no-build') use docker-compose.yml images and must NOT be used
	# for normal prod deploys — doing so switches prod onto locally-built images and
	# can serve a stale bundle if the local image is older than the GHCR one.
	[ValidateSet('pull', 'auto', 'all', 'no-build')]
	[string]$DeployMode = 'pull',

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

$script:CurrentStep = 'initializing'
$script:LogLines = [System.Collections.Generic.List[string]]::new()
$script:SessionLogFile = $null
$script:FailureReportFile = $null
$script:FailurePromptFile = $null
$script:CommitMessageFile = $null
$script:RepoRootPath = $null
$script:CommitSha = ''
$script:DeployNumber = 0
$script:BuildTimeUtc = ''

function Get-DisplayValue {
	param(
		[AllowNull()]$Value,
		[string]$Fallback = 'unknown'
	)

	$text = [string]$Value
	if ([string]::IsNullOrWhiteSpace($text)) {
		return $Fallback
	}

	return $text.Trim()
}

function Normalize-CommitText {
	param([AllowNull()][string]$Value)

	if ($null -eq $Value) {
		return ''
	}

	return (($Value -replace [string][char]0xFEFF, '' -replace '∩╗┐', '').Trim())
}

function Add-DeployLogLine {
	param([AllowEmptyString()][string]$Message)

	if ($null -eq $script:LogLines) {
		return
	}

	$script:LogLines.Add($Message) | Out-Null

	if ($script:SessionLogFile) {
		Add-Content -Path $script:SessionLogFile -Value $Message -Encoding UTF8
	}
}

function Write-Step {
	param([string]$Message)

	$line = "[deploy] $Message"
	Add-DeployLogLine -Message $line
	Write-Host $line -ForegroundColor Cyan
}

function Write-WarnLine {
	param([string]$Message)

	$line = "[deploy] $Message"
	Add-DeployLogLine -Message $line
	Write-Host $line -ForegroundColor Yellow
}

function Write-InfoLine {
	param([string]$Message)

	Add-DeployLogLine -Message $Message
	Write-Host $Message
}

function Assert-Command {
	param([string]$Name)

	if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
		throw "Required command not found: $Name"
	}
}

function Set-FileUtf8NoBom {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Path,

		[Parameter(Mandatory = $true)]
		[AllowEmptyString()]
		[AllowEmptyCollection()]
		[string[]]$Lines
	)

	$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
	[System.IO.File]::WriteAllText($Path, ($Lines -join [Environment]::NewLine), $utf8NoBom)
}

function Invoke-CapturedNative {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[string[]]$Arguments = @()
	)

	$previousErrorActionPreference = $ErrorActionPreference
	$hasNativeErrorPreference = $false
	$previousNativeErrorPreference = $false

	if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
		$hasNativeErrorPreference = $true
		$previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
	}

	try {
		$ErrorActionPreference = 'Continue'
		if ($hasNativeErrorPreference) {
			$PSNativeCommandUseErrorActionPreference = $false
		}

		$output = & $FilePath @Arguments 2>&1
		$exitCode = $LASTEXITCODE
	}
	finally {
		if ($hasNativeErrorPreference) {
			$PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
		}

		$ErrorActionPreference = $previousErrorActionPreference
	}

	$outputLines = @()
	if ($null -ne $output) {
		if ($output -is [System.Array]) {
			$outputLines = @($output | ForEach-Object { [string]$_ })
		}
		else {
			$outputLines = @([string]$output)
		}
	}

	return [pscustomobject]@{
		ExitCode = $exitCode
		Output   = $outputLines
	}
}

function Invoke-LoggedNative {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[string[]]$Arguments = @()
	)

	$result = Invoke-CapturedNative -FilePath $FilePath -Arguments $Arguments

	foreach ($line in $result.Output) {
		Add-DeployLogLine -Message $line
		Write-Host $line
	}

	return $result
}

function Invoke-CheckedCommand {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[string[]]$Arguments = @(),

		[string]$FailureMessage = 'Command failed.'
	)

	$result = Invoke-LoggedNative -FilePath $FilePath -Arguments $Arguments
	if ($result.ExitCode -ne 0) {
		throw $FailureMessage
	}

	return $result.Output
}

function Get-CommandOutput {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[string[]]$Arguments = @(),

		[string]$FailureMessage = 'Command failed.'
	)

	$result = Invoke-CapturedNative -FilePath $FilePath -Arguments $Arguments
	if ($result.ExitCode -ne 0) {
		throw $FailureMessage
	}

	return ($result.Output -join "`n").Trim()
}

function Get-SafeNativeOutput {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[string[]]$Arguments = @()
	)

	try {
		$result = Invoke-CapturedNative -FilePath $FilePath -Arguments $Arguments
		if ($result.ExitCode -ne 0) {
			return ''
		}

		return (($result.Output -join "`n").Trim())
	}
	catch {
		return ''
	}
}

function ConvertTo-BashLiteral {
	param([AllowNull()][string]$Value)

	if ($null -eq $Value) {
		return "''"
	}

	$singleQuoteEscape = [string]::Concat("'", '"', "'", '"', "'")
	return "'" + ($Value -replace "'", $singleQuoteEscape) + "'"
}

function Initialize-DiagnosticFiles {
	param(
		[Parameter(Mandatory = $true)]
		[string]$GitDirPath
	)

	$diagnosticsDir = Join-Path $GitDirPath 'waraqa-deploy-diagnostics'
	if (-not (Test-Path $diagnosticsDir)) {
		New-Item -ItemType Directory -Path $diagnosticsDir | Out-Null
	}

	$script:SessionLogFile = Join-Path $diagnosticsDir 'last-deploy-session.log'
	$script:FailureReportFile = Join-Path $diagnosticsDir 'last-deploy-error.md'
	$script:FailurePromptFile = Join-Path $diagnosticsDir 'last-deploy-copilot-prompt.txt'

	Set-Content -Path $script:SessionLogFile -Value @() -Encoding UTF8
}

function Test-RebaseInProgress {
	param(
		[Parameter(Mandatory = $true)]
		[string]$GitDirPath
	)

	return (Test-Path (Join-Path $GitDirPath 'rebase-apply')) -or (Test-Path (Join-Path $GitDirPath 'rebase-merge'))
}

function Abort-RebaseIfNeeded {
	param(
		[Parameter(Mandatory = $true)]
		[string]$GitDirPath
	)

	if (-not (Test-RebaseInProgress -GitDirPath $GitDirPath)) {
		return
	}

	Write-WarnLine 'A git rebase is in progress. Aborting it to restore a clean local state.'
	try {
		$result = Invoke-LoggedNative -FilePath 'git' -Arguments @('rebase', '--abort')
		if ($result.ExitCode -ne 0) {
			Write-WarnLine 'git rebase --abort did not complete cleanly. Check the repository state manually.'
		}
	}
	catch {
		Write-WarnLine 'git rebase --abort failed. Check the repository state manually.'
	}
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

	$highestKnownNumber = 0
	if (Test-Path $CounterFile) {
		$raw = (Get-Content -Path $CounterFile -Raw).Trim()
		if ($raw -match '^[0-9]+$') {
			$highestKnownNumber = [int]$raw
		}
	}

	$subjects = Get-SafeNativeOutput -FilePath 'git' -Arguments @('log', '--format=%s', '-n', '200')
	if ($subjects) {
		foreach ($line in ($subjects -split "`r?`n")) {
			$normalizedLine = Normalize-CommitText -Value $line
			if ($normalizedLine -match '^deploy #(\d+):') {
				$candidate = [int]$Matches[1]
				if ($candidate -gt $highestKnownNumber) {
					$highestKnownNumber = $candidate
				}
			}
		}
	}

	return ($highestKnownNumber + 1)
}

function Get-RecentLogText {
	param([int]$MaxLines = 200)

	if ($script:LogLines.Count -eq 0) {
		return ''
	}

	$skipCount = [Math]::Max(0, $script:LogLines.Count - $MaxLines)
	return (($script:LogLines | Select-Object -Skip $skipCount) -join "`n").Trim()
}

function Get-RecentCommitList {
	param(
		[string]$Range,
		[int]$Limit = 10
	)

	$result = Invoke-CapturedNative -FilePath 'git' -Arguments @('log', '--format=%h %s', '-n', ([string]$Limit), $Range)
	if ($result.ExitCode -ne 0) {
		return @()
	}

	return @($result.Output | ForEach-Object { Normalize-CommitText -Value $_ } | Where-Object { $_ })
}

function Get-CommitSummaryText {
	param(
		[string[]]$Commits,
		[string]$Fallback = '(none)'
	)

	if (-not $Commits -or $Commits.Count -eq 0) {
		return $Fallback
	}

	return ($Commits -join "`n")
}

function Get-GitState {
	param([string]$BranchName)

	$remoteRef = "origin/$BranchName"
	$localOnlyCommits = Get-RecentCommitList -Range "$remoteRef..HEAD"
	$remoteOnlyCommits = Get-RecentCommitList -Range "HEAD..$remoteRef"
	return [pscustomobject]@{
		BranchName  = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
		LocalHead   = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-parse', '--short', 'HEAD')
		RemoteHead  = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-parse', '--short', $remoteRef)
		AheadCount  = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-list', '--count', "$remoteRef..HEAD")
		BehindCount = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-list', '--count', "HEAD..$remoteRef")
		Status      = Get-SafeNativeOutput -FilePath 'git' -Arguments @('status', '--short')
		LocalOnlyCommits = Get-CommitSummaryText -Commits $localOnlyCommits
		RemoteOnlyCommits = Get-CommitSummaryText -Commits $remoteOnlyCommits
	}
}

function Build-CopilotPrompt {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FailureMessage,

		[Parameter(Mandatory = $true)]
		[pscustomobject]$GitState,

		[Parameter(Mandatory = $true)]
		[string]$RecentLog
	)

	$lines = @(
		'Please fix this Waraqa deploy failure.',
		'',
		('Failed step: {0}' -f $script:CurrentStep),
		('Failure message: {0}' -f $FailureMessage),
		('Repository: {0}' -f $script:RepoRootPath),
		('Branch: {0}' -f (Get-DisplayValue -Value $GitState.BranchName)),
		('Local HEAD: {0}' -f (Get-DisplayValue -Value $GitState.LocalHead)),
		('Remote branch HEAD: {0}' -f (Get-DisplayValue -Value $GitState.RemoteHead)),
		('Ahead count: {0}' -f (Get-DisplayValue -Value $GitState.AheadCount)),
		('Behind count: {0}' -f (Get-DisplayValue -Value $GitState.BehindCount)),
		'',
		'Local-only commits:',
		(Get-DisplayValue -Value $GitState.LocalOnlyCommits -Fallback '(none)'),
		'',
		'Remote-only commits:',
		(Get-DisplayValue -Value $GitState.RemoteOnlyCommits -Fallback '(none)'),
		'',
		'Recent deploy log:',
		(Get-DisplayValue -Value $RecentLog -Fallback '(no log output captured)'),
		'',
		'Please:',
		'1. identify the root cause',
		'2. give the safest recovery steps without losing local work',
		'3. make any code or script changes needed',
		'4. continue until the deploy path is working again'
	)

	return ($lines -join "`n").Trim()
}

function Write-FailureArtifacts {
	param(
		[Parameter(Mandatory = $true)]
		[System.Management.Automation.ErrorRecord]$ErrorRecord
	)

	$failureMessage = if ($ErrorRecord.Exception) { $ErrorRecord.Exception.Message } else { [string]$ErrorRecord }
	$gitState = Get-GitState -BranchName $Branch
	$recentLog = Get-RecentLogText -MaxLines 220
	$copilotPrompt = Build-CopilotPrompt -FailureMessage $failureMessage -GitState $gitState -RecentLog $recentLog

	if ($script:FailurePromptFile) {
		Set-Content -Path $script:FailurePromptFile -Value $copilotPrompt -Encoding UTF8
	}

	$reportLines = @(
		'# Waraqa Deploy Failure',
		'',
		('- Time (UTC): {0}' -f (Get-DisplayValue -Value $script:BuildTimeUtc -Fallback ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')))),
		('- Step: {0}' -f $script:CurrentStep),
		('- Error: {0}' -f $failureMessage),
		('- Repository: {0}' -f (Get-DisplayValue -Value $script:RepoRootPath)),
		('- Branch: {0}' -f (Get-DisplayValue -Value $gitState.BranchName)),
		('- Local HEAD: {0}' -f (Get-DisplayValue -Value $gitState.LocalHead)),
		('- Remote HEAD: {0}' -f (Get-DisplayValue -Value $gitState.RemoteHead)),
		('- Ahead: {0}' -f (Get-DisplayValue -Value $gitState.AheadCount)),
		('- Behind: {0}' -f (Get-DisplayValue -Value $gitState.BehindCount)),
		'',
		'## Local-only commits',
		'```text',
		(Get-DisplayValue -Value $gitState.LocalOnlyCommits -Fallback '(none)'),
		'```',
		'',
		'## Remote-only commits',
		'```text',
		(Get-DisplayValue -Value $gitState.RemoteOnlyCommits -Fallback '(none)'),
		'```',
		'',
		'## Git status',
		'```text',
		(Get-DisplayValue -Value $gitState.Status -Fallback '(clean)'),
		'```',
		'',
		'## Recent deploy log',
		'```text',
		(Get-DisplayValue -Value $recentLog -Fallback '(no log output captured)'),
		'```',
		'',
		'## Copilot prompt',
		'```text',
		$copilotPrompt,
		'```'
	)

	if ($script:FailureReportFile) {
		Set-Content -Path $script:FailureReportFile -Value $reportLines -Encoding UTF8
	}

	try {
		Set-Clipboard -Value $copilotPrompt
		Write-WarnLine 'A Copilot-ready fix prompt was copied to the clipboard.'
	}
	catch {
		Write-WarnLine 'Could not copy the failure prompt to the clipboard automatically.'
	}

	if ($script:FailureReportFile) {
		Write-WarnLine ("Failure report written to {0}" -f $script:FailureReportFile)
	}
	if ($script:FailurePromptFile) {
		Write-WarnLine ("Copilot prompt written to {0}" -f $script:FailurePromptFile)
	}

	Write-Host ''
	Write-Host 'Paste this into Copilot Chat and press Enter:' -ForegroundColor Yellow
	Write-Host ''
	Write-Host $copilotPrompt -ForegroundColor Yellow
}

function Get-RevisionCount {
	param([string]$Range)

	$raw = Get-SafeNativeOutput -FilePath 'git' -Arguments @('rev-list', '--count', $Range)
	if ($raw -match '^\d+$') {
		return [int]$raw
	}

	return 0
}

function Sync-BranchBeforeDeploy {
	param([string]$BranchName)

	$remoteRef = "origin/$BranchName"

	$script:CurrentStep = "checking branch sync with $remoteRef"
	Write-Step "Fetching $remoteRef"
	Invoke-CheckedCommand -FilePath 'git' -Arguments @('fetch', 'origin', $BranchName) -FailureMessage ("git fetch origin {0} failed." -f $BranchName) | Out-Null

	$syncState = Get-GitState -BranchName $BranchName
	$aheadCount = Get-RevisionCount -Range "$remoteRef..HEAD"
	$behindCount = Get-RevisionCount -Range "HEAD..$remoteRef"
	if ($aheadCount -gt 0) {
		if ($behindCount -gt 0) {
			throw ("Local branch has diverged from {0}. Reconcile these unpublished commits before running deploy again.`nLocal-only commits:`n{1}`nRemote-only commits:`n{2}" -f $remoteRef, (Get-DisplayValue -Value $syncState.LocalOnlyCommits -Fallback '(none)'), (Get-DisplayValue -Value $syncState.RemoteOnlyCommits -Fallback '(none)'))
		}

		throw ("Local branch already has {0} unpublished commit(s) ahead of {1}. Push or reconcile them before running deploy again.`nLocal-only commits:`n{2}" -f $aheadCount, $remoteRef, (Get-DisplayValue -Value $syncState.LocalOnlyCommits -Fallback '(none)'))
	}

	if ($behindCount -gt 0) {
		Write-WarnLine ("Remote {0} is ahead by {1} commit(s). Rebasing current branch before preparing the deploy commit." -f $remoteRef, $behindCount)
		$script:CurrentStep = "rebasing current branch onto $remoteRef"
		Invoke-CheckedCommand -FilePath 'git' -Arguments @('pull', '--rebase', '--autostash', 'origin', $BranchName) -FailureMessage ("git pull --rebase --autostash origin {0} failed." -f $BranchName) | Out-Null
	}
}

function Push-WithRetry {
	param([string]$BranchName)

	$pushRef = "HEAD:$BranchName"
	$remoteRef = "origin/$BranchName"
	$script:CurrentStep = "pushing $pushRef"
	Write-Step ("Pushing HEAD to origin/{0}" -f $BranchName)

	$firstAttempt = Invoke-LoggedNative -FilePath 'git' -Arguments @('push', 'origin', $pushRef)
	if ($firstAttempt.ExitCode -eq 0) {
		return
	}

	Write-WarnLine ("git push was rejected. Refreshing {0} so the failure report includes the latest remote state." -f $remoteRef)
	$script:CurrentStep = "fetching $remoteRef after push rejection"
	Invoke-CheckedCommand -FilePath 'git' -Arguments @('fetch', 'origin', $BranchName) -FailureMessage ("git fetch origin {0} failed after the push rejection." -f $BranchName) | Out-Null
	throw 'git push failed. origin/main changed during the deploy or the push was rejected for another reason. No server changes were made.'
}

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')
$gitDirPath = $null
$counterFile = $null
$historyFile = $null

Push-Location $repoRoot
try {
	$script:RepoRootPath = $repoRoot.Path

	$script:CurrentStep = 'checking required commands'
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

	$script:CurrentStep = 'resolving repository root'
	$gitTopLevel = Get-CommandOutput -FilePath 'git' -Arguments @('rev-parse', '--show-toplevel') -FailureMessage 'Failed to resolve repository root.'
	if ((Resolve-Path $gitTopLevel).Path -ne $repoRoot.Path) {
		throw ("This script must run from the Waraqa repository. Expected {0}, got {1}" -f $repoRoot.Path, $gitTopLevel)
	}

	$gitDirPath = (Resolve-Path (Get-CommandOutput -FilePath 'git' -Arguments @('rev-parse', '--git-dir') -FailureMessage 'Failed to resolve the git directory.')).Path
	$counterFile = Join-Path $gitDirPath 'waraqa-deploy-counter.txt'
	$historyFile = Join-Path $gitDirPath 'waraqa-deploy-history.log'
	$script:CommitMessageFile = Join-Path $gitDirPath 'waraqa-deploy-commit-message.txt'

	Initialize-DiagnosticFiles -GitDirPath $gitDirPath

	$safeSummary = ($WhatChanged -replace '\s+', ' ').Trim()
	if (-not $safeSummary) {
		throw 'WhatChanged cannot be empty.'
	}

	Sync-BranchBeforeDeploy -BranchName $Branch

	$script:BuildTimeUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
	$displayTimestamp = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'
	$script:DeployNumber = Get-NextDeployNumber -CounterFile $counterFile -RequestedNumber $ChangeNumber

	Write-Step ("Preparing deploy #{0}" -f $script:DeployNumber)
	Write-Step ("Summary: {0}" -f $safeSummary)
	Write-Step ("Timestamp: {0}" -f $displayTimestamp)

	$script:CurrentStep = 'reading git status'
	$statusBefore = Get-CommandOutput -FilePath 'git' -Arguments @('status', '--short') -FailureMessage 'Failed to read git status.'
	if (-not $statusBefore -and -not $AllowEmptyCommit) {
		throw 'No local changes detected. Add edits first, or rerun with -AllowEmptyCommit if you intentionally want to redeploy the current HEAD.'
	}

	$script:CurrentStep = 'staging local edits'
	Write-Step 'Staging all local edits'
	Invoke-CheckedCommand -FilePath 'git' -Arguments @('add', '-A') -FailureMessage 'git add failed.' | Out-Null

	$script:CurrentStep = 'listing staged files'
	$stagedFilesRaw = Get-CommandOutput -FilePath 'git' -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB') -FailureMessage 'Failed to list staged files.'
	$stagedFiles = @()
	if ($stagedFilesRaw) {
		$stagedFiles = @($stagedFilesRaw -split "`r?`n" | Where-Object { $_.Trim() })
	}

	if (-not $stagedFiles.Count -and -not $AllowEmptyCommit) {
		throw 'Nothing is staged after git add -A. No deploy commit was created.'
	}

	if ($stagedFiles.Count) {
		Write-Step 'Files queued for deploy:'
		$stagedFiles | ForEach-Object { Write-InfoLine ("  - {0}" -f $_) }
	}
	else {
		Write-WarnLine 'Creating an empty deploy commit because -AllowEmptyCommit was used.'
	}

	if (-not $SkipBackendSyntaxCheck) {
		$backendCheckFiles = @($stagedFiles | Where-Object { $_ -match '^backend/.+\.(js|cjs|mjs)$' })
		if ($backendCheckFiles.Count) {
			$script:CurrentStep = 'running backend syntax checks'
			Write-Step 'Running backend syntax checks on changed backend files'
			foreach ($file in $backendCheckFiles) {
				Invoke-CheckedCommand -FilePath 'node' -Arguments @('--check', $file) -FailureMessage ("Backend syntax check failed for {0}" -f $file) | Out-Null
			}
		}
	}

	if (-not $SkipLocalBuild) {
		$script:CurrentStep = 'building frontend locally'
		Write-Step 'Building the frontend locally'
		Invoke-CheckedCommand -FilePath 'npm' -Arguments @('--prefix', 'frontend', 'run', 'build') -FailureMessage 'Frontend build failed. Deployment stopped.' | Out-Null
	}

	$commitSubject = ('deploy #{0}: {1}' -f $script:DeployNumber, $safeSummary)
	$commitBody = @(
		$commitSubject,
		'',
		('Change number: {0}' -f $script:DeployNumber),
		('What changed: {0}' -f $safeSummary),
		('Created at (UTC): {0}' -f $script:BuildTimeUtc),
		''
	)

	if ($stagedFiles.Count) {
		$commitBody += 'Files:'
		$commitBody += ($stagedFiles | ForEach-Object { "- $_" })
	}
	else {
		$commitBody += 'Files:'
		$commitBody += '- (empty deploy commit)'
	}

	$script:CurrentStep = 'writing commit message'
	Set-FileUtf8NoBom -Path $script:CommitMessageFile -Lines $commitBody

	$script:CurrentStep = 'creating git commit'
	Write-Step 'Creating the git commit'
	$commitArgs = @('commit', '-F', $script:CommitMessageFile)
	if ($AllowEmptyCommit -and -not $stagedFiles.Count) {
		$commitArgs += '--allow-empty'
	}
	Invoke-CheckedCommand -FilePath 'git' -Arguments $commitArgs -FailureMessage 'git commit failed.' | Out-Null

	Set-Content -Path $counterFile -Value ([string]$script:DeployNumber) -Encoding ASCII

	$script:CurrentStep = 'reading new commit sha'
	$script:CommitSha = Get-CommandOutput -FilePath 'git' -Arguments @('rev-parse', 'HEAD') -FailureMessage 'Failed to read the new commit SHA.'

	# The branch was already reconciled with origin via Sync-BranchBeforeDeploy
	# (run before staging/committing). After committing we only need to push.
	Push-WithRetry -BranchName $Branch

	$sshArguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6')
	if ($SshKeyPath) {
		$sshArguments += @('-i', $SshKeyPath)
	}

	$targetRef = "origin/$Branch"
	$remoteCommandLines = @(
		'set -euo pipefail',
		('cd {0}' -f (ConvertTo-BashLiteral $RemotePath)),
		('export BUILD_VERSION={0}' -f (ConvertTo-BashLiteral ([string]$script:DeployNumber))),
		('export BUILD_TIME={0}' -f (ConvertTo-BashLiteral $script:BuildTimeUtc)),
		('export TARGET_REF={0}' -f (ConvertTo-BashLiteral $targetRef)),
		('export DEPLOY_NOTE={0}' -f (ConvertTo-BashLiteral $safeSummary)),
		'echo "[deploy] remote host: $HOSTNAME"',
		('echo "[deploy] change #{0}"' -f $script:DeployNumber),
		'echo "[deploy] note: ${DEPLOY_NOTE}"',
		'chmod +x deploy/scripts/deploy.sh',
		# Pushing to the branch also triggers the GitHub Actions auto-deploy, so a
		# CI deploy may already be running (holding /tmp/waraqa-deploy.lock). Wait for
		# any in-progress deploy to finish, and if the server is already at the target
		# commit (the CI deploy handled it) skip our own run. Otherwise run deploy.sh,
		# retrying if it loses a race for the lock. This keeps the script idempotent.
		('DEPLOY_BRANCH={0}' -f (ConvertTo-BashLiteral $Branch)),
		('DEPLOY_MODE={0}' -f (ConvertTo-BashLiteral $DeployMode)),
		'FRONTEND_IMAGE_REPO=ghcr.io/waraqaweb/waraqa-frontend',
		'NGINX_IMAGE_REPO=ghcr.io/waraqaweb/waraqa-nginx',
		'BACKEND_IMAGE_REPO=ghcr.io/waraqaweb/waraqa-backend',
		'git fetch origin "$DEPLOY_BRANCH" >/dev/null 2>&1 || true',
		'TARGET_SHA="$(git rev-parse "origin/$DEPLOY_BRANCH")"',
		'TARGET_IMAGE="$FRONTEND_IMAGE_REPO:$TARGET_SHA"',
		'echo "[deploy] target sha: $TARGET_SHA (mode: $DEPLOY_MODE)"',
		# Deploy is "satisfied" only when the RUNNING frontend container is the GHCR
		# image for this exact commit. Checking git HEAD alone is NOT enough: a local
		# build can leave HEAD correct while the container still serves a stale image.
		'running_is_target() { local fid img; fid="$(docker ps --filter name=frontend --format "{{.ID}}" | head -n1)"; img="$(docker inspect --format "{{.Config.Image}}" "$fid" 2>/dev/null || true)"; [ "$img" = "$TARGET_IMAGE" ]; }',
		# all_images_published: returns true only when ALL 3 app images are in GHCR.
		# Nginx is built last in CI; checking only frontend caused premature deploy starts.
		'all_images_published() { docker manifest inspect "$FRONTEND_IMAGE_REPO:$TARGET_SHA" >/dev/null 2>&1 && docker manifest inspect "$NGINX_IMAGE_REPO:$TARGET_SHA" >/dev/null 2>&1 && docker manifest inspect "$BACKEND_IMAGE_REPO:$TARGET_SHA" >/dev/null 2>&1; }',
		'deploy_ok=0',
		'if [ "$DEPLOY_MODE" = "pull" ]; then',
		# Phase 1: wait (up to ~15m) for the CI build to publish ALL 3 images,
		# or for the CI auto-deploy (triggered by this same push) to finish on its own.
		'  for w in $(seq 1 90); do',
		'    if running_is_target; then echo "[deploy] server already running image $TARGET_SHA; deploy satisfied by the concurrent CI run."; deploy_ok=1; break; fi',
		'    if all_images_published; then echo "[deploy] GHCR image $TARGET_SHA is published; proceeding to pull."; break; fi',
		'    if [ "$w" = "1" ]; then echo "[deploy] waiting for the CI image build to publish $TARGET_SHA (up to ~15m)..."; fi',
		'    sleep 10',
		'  done',
		# Phase 2: pull the GHCR image for this commit, retrying on lock races with
		# the concurrent CI deploy. Re-check "satisfied" each round so we never do a
		# redundant force-recreate if CI already deployed this exact image.
		'  if [ "$deploy_ok" != "1" ]; then',
		'    for attempt in 1 2 3 4 5 6; do',
		'      for i in $(seq 1 180); do [ -d /tmp/waraqa-deploy.lock ] || break; if [ "$i" = "1" ]; then echo "[deploy] another deploy is in progress (likely the CI auto-deploy from this push); waiting..."; fi; sleep 5; done',
		'      if running_is_target; then echo "[deploy] server already running image $TARGET_SHA; deploy satisfied by the concurrent CI run."; deploy_ok=1; break; fi',
		'      if ! all_images_published; then echo "[deploy] image $TARGET_SHA still not fully published; waiting..."; sleep 15; continue; fi',
		'      if DEPLOY_IMAGE_TAG="$TARGET_SHA" TARGET_REF="$TARGET_SHA" ./deploy/scripts/deploy.sh pull; then deploy_ok=1; break; fi',
		'      echo "[deploy] pull attempt $attempt did not complete (lock race with CI); retrying..."; sleep 5',
		'    done',
		'  fi',
		'else',
		# Legacy local-build modes (auto/all/no-build): not the production path, but
		# kept for manual overrides. Wait for any in-progress deploy, then build.
		'  for attempt in 1 2 3; do',
		'    for i in $(seq 1 180); do [ -d /tmp/waraqa-deploy.lock ] || break; if [ "$i" = "1" ]; then echo "[deploy] another deploy is in progress; waiting..."; fi; sleep 5; done',
		'    git fetch origin "$DEPLOY_BRANCH" >/dev/null 2>&1 || true',
		'    if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$DEPLOY_BRANCH")" ]; then echo "[deploy] server already at origin/$DEPLOY_BRANCH; deploy satisfied by the concurrent run."; deploy_ok=1; break; fi',
		'    if ./deploy/scripts/deploy.sh "$DEPLOY_MODE"; then deploy_ok=1; break; fi',
		'    echo "[deploy] deploy attempt $attempt did not complete (lock race); retrying..."; sleep 5',
		'  done',
		'fi',
		'if [ "$deploy_ok" != "1" ]; then echo "[deploy] ERROR: deploy did not complete after multiple attempts."; exit 1; fi'
	)
	# Join with newlines so the remote bash sees a real multi-line script.
	$remoteCommand = $remoteCommandLines -join "`n"

	# Windows PowerShell 5.1 corrupts native-command arguments that contain mixed
	# single/double quotes, which previously truncated the remote command (deploy.sh
	# never ran, yet ssh still exited 0). Base64-encode the script so the argument we
	# hand to ssh.exe contains only safe characters, then decode + run it remotely.
	$remoteCommandBytes = [System.Text.Encoding]::UTF8.GetBytes($remoteCommand)
	$remoteCommandBase64 = [System.Convert]::ToBase64String($remoteCommandBytes)
	$remoteInvocation = "echo $remoteCommandBase64 | base64 -d | bash"

	$script:CurrentStep = 'running remote deploy over ssh'
	Write-Step 'Running the server deploy over SSH'
	# The remote script is idempotent (it re-checks running image / lock state on
	# every invocation), so a dropped SSH session (exit code 255 = client/network-level
	# failure, e.g. "Connection reset") is safe to retry with a fresh connection.
	# A real remote failure exits 1 via the script's own `exit 1` and is NOT retried.
	$maxSshAttempts = 3
	$sshResult = $null
	for ($attempt = 1; $attempt -le $maxSshAttempts; $attempt++) {
		if ($attempt -gt 1) {
			Write-WarnLine "SSH connection was dropped (attempt $($attempt - 1) of $maxSshAttempts); reconnecting and resuming (the remote deploy is idempotent)..."
			Start-Sleep -Seconds 5
		}
		$sshResult = Invoke-LoggedNative -FilePath 'ssh' -Arguments ($sshArguments + @("$RemoteUser@$RemoteHost", $remoteInvocation))
		if ($sshResult.ExitCode -eq 0) {
			break
		}
		if ($sshResult.ExitCode -ne 255) {
			# A real remote failure (e.g. the script's own `exit 1`) — do not retry.
			break
		}
	}
	if ($sshResult.ExitCode -ne 0) {
		throw 'Remote deploy failed after the push succeeded. Check the generated failure prompt and server logs.'
	}

	Add-Content -Path $historyFile -Value ("{0}`t#{1}`t{2}`t{3}" -f $script:BuildTimeUtc, $script:DeployNumber, $script:CommitSha, $safeSummary) -Encoding UTF8

	Write-Step 'Deployment completed successfully'
	Write-Host ("[deploy] Commit: {0}" -f $script:CommitSha) -ForegroundColor Green
	Write-Host ("[deploy] Branch: origin/{0}" -f $Branch) -ForegroundColor Green
	Write-Host ("[deploy] Deploy number: #{0}" -f $script:DeployNumber) -ForegroundColor Green
}
catch {
	if ($gitDirPath) {
		Abort-RebaseIfNeeded -GitDirPath $gitDirPath
	}
	Write-FailureArtifacts -ErrorRecord $_
	throw
}
finally {
	if ($script:CommitMessageFile -and (Test-Path $script:CommitMessageFile)) {
		Remove-Item $script:CommitMessageFile -Force -ErrorAction SilentlyContinue
	}
	Pop-Location
}

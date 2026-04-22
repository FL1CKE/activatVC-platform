param()

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".git")) {
	throw "This folder is not a git repository. Initialize git or clone the repo first."
}

git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
	throw "Failed to set core.hooksPath to .githooks"
}

Write-Host "Git hooks path set to .githooks"
Write-Host "Ensure gitleaks is installed locally before committing."

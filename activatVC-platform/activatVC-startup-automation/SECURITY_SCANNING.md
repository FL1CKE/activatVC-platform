# Secret scanning setup

This repository is protected against accidental secret commits using Gitleaks.

## Local protection (pre-commit)

1. Install `gitleaks`:
   - https://github.com/gitleaks/gitleaks#installation
2. Activate tracked git hooks in this repo:

```powershell
./scripts/install-git-hooks.ps1
```

After activation, `.githooks/pre-commit` scans staged changes and blocks commit if secrets are detected.

## CI protection

GitHub Actions workflow:

- `.github/workflows/secret-scan.yml`

Runs on push, pull request, and manual dispatch.

## Configuration

- `.gitleaks.toml`

Contains an allowlist for known placeholders used in test/example values.

# Activat VC Platform

This repository contains both services required to run the Activat VC platform:

- `activatVC-startup-automation` — master orchestrator, founder portal, investor dashboard
- `activatVC-agents-platform` — specialist AI agents platform

## Repository Layout

```text
activatVC-startup-automation/
activatVC-agents-platform/
```

## What Is Intentionally Not Included

- test startup files
- VM-specific top-level deployment artifacts
- real `.env` files with secrets
- `storage/llm-settings.json` runtime file

`llm-settings.json` is created automatically after first save from the admin settings UI and is not required for initial startup.

## Quick Start

1. Configure environment files from examples:
   - `activatVC-startup-automation/.env.connected.example`
   - `activatVC-startup-automation/.env.vm.example`
   - `activatVC-agents-platform/.env.example`
2. Start infrastructure for `activatVC-startup-automation`.
3. Start `activatVC-agents-platform`.
4. Start `activatVC-startup-automation`.
5. Start the frontend in `activatVC-startup-automation/client`.

For service-specific setup details, read each project README.
# Commands

Quick reference for setting up, running, and testing Insurance Premium Hub.
For full context see [README.md](README.md).

## Setup

```bash
npm install
```

Also create `.env` (see `.env.example`) — `mc_server.js` will not start without
`MC_AUTH_TOKEN` and `MC_AES_KEY` set.

## Build

There is no build/compile step. This is a plain Node/Express backend serving
static HTML/JS directly — `npm install` is the only prerequisite before running.

## Run

Start all four servers and open the hub:

```bash
start_all.bat
```

Or start one at a time:

| Command | Insurer | Port |
|---|---|---|
| `npm run care` | Care Health | 3005 |
| `npm run niva` | Niva Bupa | 3002 |
| `npm run mc` | ManipalCigna | 3003 |
| `npm run star` | Star Health | 3004 |

Or start all four at once in a single terminal (background jobs, one Ctrl+C
to stop all — bash/git-bash):

```bash
npm run care & npm run niva & npm run mc & npm run star &
```

PowerShell equivalent (`&` is not a background operator in PowerShell —
use `Start-Job`):

```powershell
Start-Job -Name care { Set-Location $using:PWD; npm run care }
Start-Job -Name niva { Set-Location $using:PWD; npm run niva }
Start-Job -Name mc   { Set-Location $using:PWD; npm run mc }
Start-Job -Name star { Set-Location $using:PWD; npm run star }
```

`Start-Job` output isn't printed live — check it with `Receive-Job -Name care
-Keep`, list jobs with `Get-Job`, stop everything with `Get-Job | Stop-Job;
Get-Job | Remove-Job`. Or just run `start_all.bat`, which opens each server in
its own visible window.

Hub: `http://localhost:3005/hub`

## Verify / test

```bash
npm run verify
```

Runs all checks. Individually:

| Command | Checks |
|---|---|
| `npm run verify:picker` | Plan picker eligibility rules |
| `npm run verify:mc` | ManipalCigna Plan Type / resident-Indian handling |
| `npm run verify:care` | Care plan-type handling |
| `npm run verify:star` | Star Health sum-insured |
| `npm run verify:features` | Feature comparison columns |
| `npm run verify:history` | Quotation history round-trip |
| `npm run verify:excel` | Spreadsheet format vs. client reference |
| `npm run verify:pdf` | Excel vs. PDF output agreement |
| `npm run audit:care` | Live Care portal vs. `care_plans.json` |

Some verify scripts need `jsdom` (dev-only, not a saved dependency):

```bash
npm install --no-save jsdom
npm run verify
npm prune
```

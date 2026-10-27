Push-Location $PSScriptRoot
try { node --env-file=.env --import tsx scripts/open-workbench.ts } finally { Pop-Location }

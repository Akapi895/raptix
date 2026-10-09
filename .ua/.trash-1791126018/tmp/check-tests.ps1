$ErrorActionPreference = 'Stop'
$b = Get-Content "D:\.VTNet\redteam\raptix\.ua\intermediate\batches.json" -Raw | ConvertFrom-Json
foreach ($i in @(11,12,13,14,15)) {
  $bat = $b.batches | Where-Object { $_.batchIndex -eq $i }
  $testFiles = $bat.files | Where-Object { $_.path -match '(test|spec)\.(py|ts|tsx)$' -or $_.path -match '/tests/' -or $_.path -match '__tests__' }
  Write-Output ("batch-{0}: {1} test files" -f $i, @($testFiles).Count)
  foreach ($t in $testFiles) { Write-Output ("  " + $t.path) }
}

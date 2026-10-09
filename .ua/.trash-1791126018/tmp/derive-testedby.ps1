$ErrorActionPreference = 'Stop'
$b = Get-Content "D:\.VTNet\redteam\raptix\.ua\intermediate\batches.json" -Raw | ConvertFrom-Json
foreach ($i in @(13,14,15)) {
  $bat = $b.batches | Where-Object { $_.batchIndex -eq $i }
  $inBatch = @{}
  foreach ($f in $bat.files) { $inBatch[$f.path] = $true }
  Write-Output "=== batch-$i reversed imports (test => tested-in-batch) ==="
  foreach ($k in $bat.batchImportData.PSObject.Properties.Name) {
    if ($k -match '(test|spec)\.(py|ts|tsx)$' -or $k -match '/tests/') {
      $targets = @()
      foreach ($t in $bat.batchImportData.$k) { if ($inBatch.ContainsKey($t)) { $targets += $t } }
      if ($targets.Count) { Write-Output ("  " + $k + " => " + ($targets -join ", ")) }
      else { Write-Output ("  " + $k + " => (no in-batch imports)") }
    }
  }
}

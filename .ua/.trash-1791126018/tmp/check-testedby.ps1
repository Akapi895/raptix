$ErrorActionPreference = 'Stop'
$b = Get-Content "D:\.VTNet\redteam\raptix\.ua\intermediate\batches.json" -Raw | ConvertFrom-Json
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
# batch-17: verify tested_by pairs == reversed import relation from test files
$bat17 = $b.batches | Where-Object { $_.batchIndex -eq 17 }
$ex17 = Get-Content "$ua\batch-17.json" -Raw | ConvertFrom-Json
$tb17 = @{}
foreach ($e in ($ex17.edges | Where-Object { $_.type -eq 'tested_by' })) { $tb17[$e.source + "=>" + $e.target] = $true }
$derived = @{}
foreach ($k in $bat17.batchImportData.PSObject.Properties.Name) {
  if ($k -match '(test|spec)\.(py|ts|tsx)$' -or $k -match '/tests/') {
    foreach ($t in $bat17.batchImportData.$k) {
      $pair = "file:" + $t + "=>" + "file:" + $k
      if (-not $derived.ContainsKey($pair)) { $derived[$pair] = $true }
    }
  }
}
$inBatch17 = @{}
foreach ($f in $bat17.files) { $inBatch17["file:" + $f.path] = $true }
$missing = @(); $extra = @()
foreach ($k in $derived.Keys) {
  $src = $k.Split('=>')[0]
  if ($inBatch17.ContainsKey($src) -and -not $tb17.ContainsKey($k)) { $missing += $k }
}
foreach ($k in $tb17.Keys) { if (-not $derived.ContainsKey($k)) { $extra += $k } }
Write-Output ("batch-17: derived-in-batch={0} tested_by-edges={1} missing={2} extra={3}" -f $derived.Count, $tb17.Count, $missing.Count, $extra.Count)
if ($missing.Count) { $missing | Select-Object -First 5 | ForEach-Object { Write-Output "  MISSING: $_" } }
if ($extra.Count) { $extra | Select-Object -First 5 | ForEach-Object { Write-Output "  EXTRA: $_" } }

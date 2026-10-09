$ErrorActionPreference = 'Stop'
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
# Check batch-1/9/10: are imports edges' targets always in-batch nodes?
foreach ($i in @(1,9,10,16)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw | ConvertFrom-Json
  $nodeIds = @{}
  foreach ($n in $ex.nodes) { $nodeIds[$n.id] = $true }
  $ext = 0; $in = 0
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'imports' })) {
    if ($nodeIds.ContainsKey($e.target)) { $in++ } else { $ext++ }
  }
  Write-Output ("batch-{0}: imports in-batch={1} external={2}" -f $i, $in, $ext)
}
# Check batch-11/14/15: are the "bad" import targets files that exist in OTHER batches?
$b = Get-Content "$ua\batches.json" -Raw | ConvertFrom-Json
$allPaths = @{}
foreach ($bat in $b.batches) { foreach ($f in $bat.files) { $allPaths[$f.path] = $true } }
foreach ($i in @(11,14,15)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw | ConvertFrom-Json
  $nodeIds = @{}
  foreach ($n in $ex.nodes) { $nodeIds[$n.id] = $true }
  $extInProject = 0; $extOutside = 0
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'imports' })) {
    if (-not $nodeIds.ContainsKey($e.target)) {
      $tp = $e.target -replace '^file:', ''
      if ($allPaths.ContainsKey($tp)) { $extInProject++ } else { $extOutside++ }
    }
  }
  Write-Output ("batch-{0}: external-import targets: in-project={1} outside-project={2}" -f $i, $extInProject, $extOutside)
}

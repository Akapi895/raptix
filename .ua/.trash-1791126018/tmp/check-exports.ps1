$ErrorActionPreference = 'Stop'
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
foreach ($i in @(11,12,13,14,15)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw | ConvertFrom-Json
  $o = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-output-$i.json" -Raw | ConvertFrom-Json
  # expected exports: symbol nodes whose name is in the file's exports list
  $expectedExports = @{}
  $nodesByFile = @{}
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    if (-not $nodesByFile.ContainsKey($n.filePath)) { $nodesByFile[$n.filePath] = @() }
    $nodesByFile[$n.filePath] += $n
  }
  foreach ($r in $o.results) {
    if (-not $r.exports) { continue }
    $exportNames = @{}
    foreach ($e in $r.exports) { $exportNames[$e.name] = $true }
    if ($nodesByFile.ContainsKey($r.path)) {
      foreach ($n in $nodesByFile[$r.path]) {
        if ($exportNames.ContainsKey($n.name)) {
          $expectedExports["file:" + $r.path + "=>" + $n.id] = $true
        }
      }
    }
  }
  $exportsPairs = @{}
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'exports' })) {
    $exportsPairs[$e.source + "=>" + $e.target] = $true
  }
  $missing = @(); $extra = @()
  foreach ($k in $expectedExports.Keys) { if (-not $exportsPairs.ContainsKey($k)) { $missing += $k } }
  foreach ($k in $exportsPairs.Keys) { if (-not $expectedExports.ContainsKey($k)) { $extra += $k } }
  Write-Output ("batch-{0}: exports missing={1} extra={2}" -f $i, $missing.Count, $extra.Count)
  if ($missing.Count) { $missing | Select-Object -First 5 | ForEach-Object { Write-Output "  MISSING: $_" } }
  if ($extra.Count) { $extra | Select-Object -First 5 | ForEach-Object { Write-Output "  EXTRA: $_" } }
}
# batch-13: the one missing calls edge - check what callGraph says
$ex13 = Get-Content "$ua\batch-13.json" -Raw | ConvertFrom-Json
$o13 = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-output-13.json" -Raw | ConvertFrom-Json
$callsPairs = @{}
foreach ($e in ($ex13.edges | Where-Object { $_.type -eq 'calls' })) { $callsPairs[$e.source + "=>" + $e.target] = $true }
$nodes13 = @{}
foreach ($n in ($ex13.nodes | Where-Object { $_.type -in @('function','class') })) { $nodes13[$n.name] = $n.id }
foreach ($r in $o13.results) {
  if (-not $r.callGraph) { continue }
  foreach ($c in $r.callGraph) {
    if ($nodes13.ContainsKey($c.caller) -and $nodes13.ContainsKey($c.callee)) {
      $k = $nodes13[$c.caller] + "=>" + $nodes13[$c.callee]
      if (-not $callsPairs.ContainsKey($k)) {
        Write-Output "batch-13 missing call: $($c.caller) => $($c.callee) (line $($c.lineNumber)) in $($r.path)"
      }
    }
  }
}

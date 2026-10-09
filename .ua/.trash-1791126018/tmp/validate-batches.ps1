$ErrorActionPreference = 'Stop'
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
foreach ($i in @(11,12,13,14,15)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw | ConvertFrom-Json
  $o = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-output-$i.json" -Raw | ConvertFrom-Json
  $inp = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-input-$i.json" -Raw | ConvertFrom-Json

  $nodeIds = @{}
  foreach ($n in $ex.nodes) { $nodeIds[$n.id] = $true }

  # A. file nodes for every batchFile
  $missingFileNodes = @()
  foreach ($f in $inp.batchFiles) {
    $fid = "file:" + $f.path
    if (-not $nodeIds.ContainsKey($fid)) { $missingFileNodes += $f.path }
  }

  # B. edge endpoint integrity + self-edges
  $badEndpoints = @(); $selfEdges = @()
  foreach ($e in $ex.edges) {
    if (-not $nodeIds.ContainsKey($e.source) -or -not $nodeIds.ContainsKey($e.target)) {
      $badEndpoints += ($e.type + ": " + $e.source + " => " + $e.target)
    }
    if ($e.source -eq $e.target) { $selfEdges += ($e.type + ": " + $e.source) }
  }

  # C. contains edges: every fn/cls node contained by its file
  $containsPairs = @{}
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'contains' })) {
    $containsPairs[$e.source + "=>" + $e.target] = $true
  }
  $missingContains = @()
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    $key = "file:" + $n.filePath + "=>" + $n.id
    if (-not $containsPairs.ContainsKey($key)) { $missingContains += $n.id }
  }

  # D. calls edges vs callGraph (within batch, mapped through significant nodes)
  $sigNames = @{}
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    $sigNames[$n.name] = $n.id
  }
  $callGraphPairs = @{}
  foreach ($r in $o.results) {
    if ($r.callGraph) {
      foreach ($c in $r.callGraph) {
        if ($sigNames.ContainsKey($c.caller) -and $sigNames.ContainsKey($c.callee)) {
          $callGraphPairs[$sigNames[$c.caller] + "=>" + $sigNames[$c.callee]] = $true
        }
      }
    }
  }
  $callsEdges = @{}
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'calls' })) {
    $callsEdges[$e.source + "=>" + $e.target] = $true
  }
  $missingCalls = @(); $extraCalls = @()
  foreach ($k in $callGraphPairs.Keys) { if (-not $callsEdges.ContainsKey($k)) { $missingCalls += $k } }
  foreach ($k in $callsEdges.Keys) { if (-not $callGraphPairs.ContainsKey($k)) { $extraCalls += $k } }

  # E. exports edges for all symbol nodes
  $exportsPairs = @{}
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'exports' })) {
    $exportsPairs[$e.source + "=>" + $e.target] = $true
  }
  $missingExports = @()
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    $key = "file:" + $n.filePath + "=>" + $n.id
    if (-not $exportsPairs.ContainsKey($key)) { $missingExports += $n.id }
  }

  Write-Output ("batch-{0}: missingFileNodes={1} badEndpoints={2} selfEdges={3} missingContains={4} missingCalls={5} extraCalls={6} missingExports={7}" -f $i, $missingFileNodes.Count, $badEndpoints.Count, $selfEdges.Count, $missingContains.Count, $missingCalls.Count, $extraCalls.Count, $missingExports.Count)
  if ($badEndpoints.Count) { $badEndpoints | Select-Object -First 3 | ForEach-Object { Write-Output "  BAD: $_" } }
  if ($missingContains.Count) { $missingContains | Select-Object -First 3 | ForEach-Object { Write-Output "  NO-CONTAINS: $_" } }
  if ($missingExports.Count) { $missingExports | Select-Object -First 3 | ForEach-Object { Write-Output "  NO-EXPORTS: $_" } }
  if ($missingCalls.Count) { $missingCalls | Select-Object -First 3 | ForEach-Object { Write-Output "  NO-CALLS: $_" } }
  if ($extraCalls.Count) { $extraCalls | Select-Object -First 3 | ForEach-Object { Write-Output "  EXTRA-CALLS: $_" } }
}

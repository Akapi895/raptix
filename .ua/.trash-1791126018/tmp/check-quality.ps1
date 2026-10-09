$ErrorActionPreference = 'Stop'
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
$validPrefixes = @('file:','config:','document:','service:','pipeline:','resource:','table:','schema:','endpoint:','function:','class:')
foreach ($i in @(11,12,13,14,15)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw | ConvertFrom-Json
  # ID format
  $badIds = @()
  foreach ($n in $ex.nodes) {
    $ok = $false
    foreach ($p in $validPrefixes) { if ($n.id.StartsWith($p)) { $ok = $true; break } }
    if (-not $ok) { $badIds += $n.id }
    if ($n.id -match '^[A-Za-z]:[\\/]' -or $n.id -match '^(raptix|D_|D:)') { $badIds += ("PROJPATH: " + $n.id) }
  }
  # dup nodes
  $idSeen = @{}; $dupNodes = @()
  foreach ($n in $ex.nodes) { if ($idSeen.ContainsKey($n.id)) { $dupNodes += $n.id } else { $idSeen[$n.id] = $true } }
  # dup edges
  $edgeSeen = @{}; $dupEdges = @()
  foreach ($e in $ex.edges) {
    $k = $e.type + "|" + $e.source + "|" + $e.target
    if ($edgeSeen.ContainsKey($k)) { $dupEdges += $k } else { $edgeSeen[$k] = $true }
  }
  # node quality
  $badSummary = @(); $badTags = @(); $badComplexity = @(); $badLineRange = @(); $missingName = @()
  foreach ($n in $ex.nodes) {
    if (-not $n.summary -or $n.summary.Trim().Length -lt 10) { $badSummary += $n.id }
    $tc = if ($n.tags) { $n.tags.Count } else { 0 }
    if ($tc -lt 3 -or $tc -gt 5) { $badTags += ($n.id + " tags=" + $tc) }
    if ($n.complexity -notin @('simple','moderate','complex')) { $badComplexity += $n.id }
    if ($n.type -in @('function','class')) {
      if (-not $n.lineRange -or $n.lineRange.Count -ne 2 -or $n.lineRange[0] -gt $n.lineRange[1]) { $badLineRange += $n.id }
    }
    if (-not $n.name) { $missingName += $n.id }
  }
  # edge metadata
  $badEdgeMeta = @()
  foreach ($e in $ex.edges) {
    if (-not $e.direction -or -not ($e.weight -is [double] -or $e.weight -is [int])) { $badEdgeMeta += ($e.type + "|" + $e.source) }
  }
  # file node fields
  $badFileNodes = @()
  foreach ($n in ($ex.nodes | Where-Object { $_.type -eq 'file' })) {
    if (-not $n.filePath -or -not $n.name) { $badFileNodes += $n.id }
  }
  Write-Output ("batch-{0}: badIds={1} dupNodes={2} dupEdges={3} badSummary={4} badTags={5} badComplexity={6} badLineRange={7} missingName={8} badEdgeMeta={9} badFileNodes={10}" -f $i, $badIds.Count, $dupNodes.Count, $dupEdges.Count, $badSummary.Count, $badTags.Count, $badComplexity.Count, $badLineRange.Count, $missingName.Count, $badEdgeMeta.Count, $badFileNodes.Count)
  if ($badIds.Count) { $badIds | Select-Object -First 3 | ForEach-Object { Write-Output "  BADID: $_" } }
  if ($badTags.Count) { $badTags | Select-Object -First 3 | ForEach-Object { Write-Output "  BADTAGS: $_" } }
  if ($badSummary.Count) { $badSummary | Select-Object -First 3 | ForEach-Object { Write-Output "  BADSUM: $_" } }
  if ($badComplexity.Count) { $badComplexity | Select-Object -First 3 | ForEach-Object { Write-Output "  BADCPLX: $_" } }
  if ($badEdgeMeta.Count) { $badEdgeMeta | Select-Object -First 3 | ForEach-Object { Write-Output "  BADEMETA: $_" } }
}

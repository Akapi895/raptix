$ErrorActionPreference = 'Stop'
$src = Get-Content "D:\.VTNet\redteam\raptix\.ua\intermediate\batches.json" -Raw | ConvertFrom-Json
$existingIds = @{}
Get-ChildItem "D:\.VTNet\redteam\raptix\.ua\intermediate" -Filter "batch-*.json" |
  Where-Object { $_.Name -notmatch '^batch-(9[1-5])\.json$' } |
  ForEach-Object {
    $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
    foreach ($n in $j.nodes) { $existingIds[$n.id] = $true }
  }
$allPlannedPaths = @{}
foreach ($b in $src.batches) {
  foreach ($f in $b.files) {
    if (-not $allPlannedPaths.ContainsKey($f.path)) { $allPlannedPaths[$f.path] = $f.fileCategory }
  }
}
$catToPrefix = @{ 'code'='file:'; 'config'='config:'; 'docs'='document:'; 'infra'='service:'; 'data'='table:'; 'script'='file:'; 'markup'='file:' }
$ok = $true
foreach ($idx in 91..95) {
  $p = "D:\.VTNet\redteam\raptix\.ua\intermediate\batch-$idx.json"
  try { $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Write-Output "batch-$idx : INVALID JSON"; $ok=$false; continue }
  $b = $src.batches | Where-Object { $_.batchIndex -eq $idx }
  $srcFiles = @($b.files); $outFiles = @($j.batchFiles)
  $match = ($srcFiles.Count -eq $outFiles.Count)
  if ($match) {
    for ($k=0; $k -lt $srcFiles.Count; $k++) {
      foreach ($fld in 'path','language','sizeLines','fileCategory') {
        if ($srcFiles[$k].$fld -ne $outFiles[$k].$fld) {
          $match=$false
          Write-Output "  field mismatch $idx file $k field ${fld}: '$($srcFiles[$k].$fld)' vs '$($outFiles[$k].$fld)'"
        }
      }
    }
  }
  $errs=@()
  if (-not $match) { $errs += "batchFiles MISMATCH" }
  if ($j.batchIndex -ne $idx) { $errs += "batchIndex wrong" }
  foreach ($n in $j.nodes) {
    if ($n.id -notmatch '^(file|function|class|module|concept|config|document|service|table|endpoint|pipeline|schema|resource):') { $errs += "BAD ID PREFIX: $($n.id)" }
    if (-not $n.summary -or $n.summary.Length -lt 20) { $errs += "weak summary: $($n.id)" }
    $tagCount = @($n.tags).Count
    if ($tagCount -lt 3 -or $tagCount -gt 5) { $errs += "tags out of range: $($n.id) ($tagCount)" }
    if ($n.complexity -notin @('simple','moderate','complex')) { $errs += "bad complexity: $($n.id)" }
  }
  $ids = @{}
  foreach ($n in $j.nodes) { $ids[$n.id] = $true }
  foreach ($e in $j.edges) {
    if (-not $ids.ContainsKey($e.source)) { $errs += "edge source NOT in batch nodes: $($e.source)" }
    if ($e.source -eq $e.target) { $errs += "SELF-EDGE: $($e.source)" }
    if (-not $ids.ContainsKey($e.target)) {
      if ($existingIds.ContainsKey($e.target)) { continue }
      $tgt = $e.target -replace '^(file|function|class|config|document|service|table|endpoint|pipeline|schema|resource):','' -replace ':.*$',''
      if ($allPlannedPaths.ContainsKey($tgt)) {
        $wantPrefix = $catToPrefix[$allPlannedPaths[$tgt]]
        if (-not $e.target.StartsWith($wantPrefix)) { $errs += "cross-batch prefix WRONG for $tgt (cat=$($allPlannedPaths[$tgt])): $($e.target)" }
      } else {
        $errs += "cross-batch target UNKNOWN anywhere: $($e.target)"
      }
    }
  }
  if ($errs.Count -gt 0) { Write-Output "batch-$idx : ERRORS: $($errs -join '; ')"; $ok=$false }
  else { Write-Output "batch-$idx : OK (nodes=$(@($j.nodes).Count), edges=$(@($j.edges).Count))" }
}
Write-Output "---"
if ($ok) { Write-Output "ALL 5 BATCHES VALID" } else { Write-Output "VALIDATION FAILED" }

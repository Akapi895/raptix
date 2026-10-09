$ErrorActionPreference = 'Stop'
$ua = "D:\.VTNet\redteam\raptix\.ua\intermediate"
$validPrefixes = @('file:','config:','document:','service:','pipeline:','resource:','table:','schema:','endpoint:','function:','class:')
$allPass = $true
foreach ($i in @(11,12,13,14,15)) {
  $ex = Get-Content "$ua\batch-$i.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $o = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-output-$i.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $inp = Get-Content "D:\.VTNet\redteam\raptix\.ua\tmp\ua-file-analyzer-input-$i.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $b = Get-Content "$ua\batches.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $bat = $b.batches | Where-Object { $_.batchIndex -eq $i }
  $errors = @()

  # 1. batchIndex
  if ($ex.batchIndex -ne $i) { $errors += "batchIndex wrong" }

  # 2. batchFiles verbatim (4 fields, order)
  if ($ex.batchFiles.Count -ne $bat.files.Count) { $errors += "batchFiles count" }
  for ($x = 0; $x -lt [Math]::Min($ex.batchFiles.Count, $bat.files.Count); $x++) {
    $e = $ex.batchFiles[$x]; $s = $bat.files[$x]
    if ($e.path -ne $s.path -or $e.language -ne $s.language -or $e.sizeLines -ne $s.sizeLines -or $e.fileCategory -ne $s.fileCategory) { $errors += "batchFiles[$x] mismatch" }
  }

  # 3. nodes: file node per batchFile
  $nodeIds = @{}
  foreach ($n in $ex.nodes) { $nodeIds[$n.id] = $true }
  foreach ($f in $inp.batchFiles) { if (-not $nodeIds.ContainsKey("file:" + $f.path)) { $errors += "missing file node: " + $f.path } }

  # 4. significant symbols match extraction
  $exp = @{}
  foreach ($r in $o.results) {
    $exportSet = @{}
    if ($r.exports) { foreach ($e in $r.exports) { $exportSet[$e.name] = $true } }
    if ($r.functions) { foreach ($f in $r.functions) { $lines = $f.endLine - $f.startLine + 1; if ($lines -ge 10 -or $exportSet.ContainsKey($f.name)) { $exp[$r.path + "::" + $f.name] = $true } } }
    if ($r.classes) { foreach ($c in $r.classes) { $lines = $c.endLine - $c.startLine + 1; if ($c.methods.Count -ge 2 -or $lines -ge 20 -or $exportSet.ContainsKey($c.name)) { $exp[$r.path + "::" + $c.name] = $true } } }
  }
  $exSym = @{}
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    $rest = $n.id.Substring($n.id.IndexOf(':') + 1); $idx2 = $rest.LastIndexOf(':')
    $exSym[$rest.Substring(0, $idx2) + "::" + $rest.Substring($idx2 + 1)] = $true
  }
  foreach ($k in $exp.Keys) { if (-not $exSym.ContainsKey($k)) { $errors += "missing symbol: $k" } }
  foreach ($k in $exSym.Keys) { if (-not $exp.ContainsKey($k)) { $errors += "extra symbol: $k" } }

  # 5. imports 1:1 (self-imports excluded)
  $impExpected = 0
  foreach ($k in $bat.batchImportData.PSObject.Properties.Name) { foreach ($t in $bat.batchImportData.$k) { if ($k -ne $t) { $impExpected++ } } }
  $impActual = ($ex.edges | Where-Object { $_.type -eq 'imports' }).Count
  if ($impExpected -ne $impActual) { $errors += "imports $impActual != expected $impExpected" }
  $impPairs = @{}
  foreach ($e in ($ex.edges | Where-Object { $_.type -eq 'imports' })) { $impPairs[$e.source + "=>" + $e.target] = $true }
  foreach ($k in $bat.batchImportData.PSObject.Properties.Name) {
    foreach ($t in $bat.batchImportData.$k) {
      if ($k -ne $t) { $key = "file:" + $k + "=>file:" + $t; if (-not $impPairs.ContainsKey($key)) { $errors += "missing import: $key" } }
    }
  }

  # 6. contains/exports coverage
  $containsPairs = @{}; $exportsPairs = @{}; $callsPairs = @{}
  foreach ($e in $ex.edges) {
    $k = $e.source + "=>" + $e.target
    if ($e.type -eq 'contains') { $containsPairs[$k] = $true }
    elseif ($e.type -eq 'exports') { $exportsPairs[$k] = $true }
    elseif ($e.type -eq 'calls') { $callsPairs[$k] = $true }
  }
  $nodesByFile = @{}
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) {
    if (-not $nodesByFile.ContainsKey($n.filePath)) { $nodesByFile[$n.filePath] = @() }
    $nodesByFile[$n.filePath] += $n
    $key = "file:" + $n.filePath + "=>" + $n.id
    if (-not $containsPairs.ContainsKey($key)) { $errors += "missing contains: $key" }
  }
  foreach ($r in $o.results) {
    if (-not $r.exports) { continue }
    $exportNames = @{}
    foreach ($e in $r.exports) { $exportNames[$e.name] = $true }
    if ($nodesByFile.ContainsKey($r.path)) {
      foreach ($n in $nodesByFile[$r.path]) {
        if ($exportNames.ContainsKey($n.name)) {
          $key = "file:" + $r.path + "=>" + $n.id
          if (-not $exportsPairs.ContainsKey($key)) { $errors += "missing exports: $key" }
        }
      }
    }
  }

  # 7. calls vs callGraph
  $sigNames = @{}
  foreach ($n in ($ex.nodes | Where-Object { $_.type -in @('function','class') })) { $sigNames[$n.name] = $n.id }
  foreach ($r in $o.results) {
    if (-not $r.callGraph) { continue }
    foreach ($c in $r.callGraph) {
      if ($sigNames.ContainsKey($c.caller) -and $sigNames.ContainsKey($c.callee)) {
        $k = $sigNames[$c.caller] + "=>" + $sigNames[$c.callee]
        if (-not $callsPairs.ContainsKey($k)) { $errors += "missing calls: $k" }
      }
    }
  }

  # 8. self-edges, dup edges, dup nodes, endpoints
  $edgeSeen = @{}; $idSeen = @{}
  foreach ($e in $ex.edges) {
    if ($e.source -eq $e.target) { $errors += "self-edge: " + $e.source }
    if (-not $nodeIds.ContainsKey($e.source)) { $errors += "dangling source: " + $e.source }
    if (-not $nodeIds.ContainsKey($e.target)) {
      # external file refs allowed for imports/tested_by/depends_on only
      $tp = $e.target -replace '^file:', ''
      if ($e.type -notin @('imports','tested_by','depends_on') -or -not ($e.target -match '^file:')) { $errors += "dangling target: " + $e.target }
    }
    $k = $e.type + "|" + $e.source + "|" + $e.target
    if ($edgeSeen.ContainsKey($k)) { $errors += "dup edge: $k" }
    $edgeSeen[$k] = $true
  }
  foreach ($n in $ex.nodes) {
    if ($idSeen.ContainsKey($n.id)) { $errors += "dup node: " + $n.id }
    $idSeen[$n.id] = $true
    $ok = $false
    foreach ($p in $validPrefixes) { if ($n.id.StartsWith($p)) { $ok = $true; break } }
    if (-not $ok) { $errors += "bad id: " + $n.id }
    if (-not $n.summary -or $n.summary.Trim().Length -lt 10) { $errors += "bad summary: " + $n.id }
    $tc = if ($n.tags) { $n.tags.Count } else { 0 }
    if ($tc -lt 3 -or $tc -gt 5) { $errors += "bad tags($tc): " + $n.id }
    if ($n.complexity -notin @('simple','moderate','complex')) { $errors += "bad complexity: " + $n.id }
    if ($n.type -in @('function','class')) {
      if (-not $n.lineRange -or $n.lineRange.Count -ne 2 -or $n.lineRange[0] -gt $n.lineRange[1]) { $errors += "bad lineRange: " + $n.id }
    }
  }

  $status = if ($errors.Count -eq 0) { "PASS" } else { "FAIL"; $allPass = $false }
  Write-Output ("batch-{0}: nodes={1} edges={2} -> {3}" -f $i, $ex.nodes.Count, $ex.edges.Count, $status)
  $errors | Select-Object -First 10 | ForEach-Object { Write-Output "  ERR: $_" }
}
Write-Output ""
Write-Output ("OVERALL: " + $(if ($allPass) { "ALL PASS" } else { "FAILURES FOUND" }))

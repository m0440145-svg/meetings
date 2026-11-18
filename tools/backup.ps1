<#
  Mithaq backup (F-08): database dump + storage files, run from an admin's PC. NOT meant for GitHub Actions
  (the repository is public; a dump must never be stored there).

  Needs: PostgreSQL client tools (pg_dump) on PATH, and two environment variables that you set yourself
  (never commit them, never paste them in chat):
    MITHAQ_DB_URL       postgresql://postgres:<password>@db.hmauemcowlaqujeatbaz.supabase.co:5432/postgres
                        (Supabase > Project Settings > Database > Connection string; or the pooler URL)
    MITHAQ_SERVICE_KEY  service_role key (Project Settings > API). Only needed for storage files.

  Usage:   powershell -ExecutionPolicy Bypass -File tools\backup.ps1
           options: -OutDir D:\backups  -KeepDays 30  -SkipStorage
  Output:  <OutDir>\mithaq-YYYYMMDD-HHMM\  public.sql, auth-users.sql (SENSITIVE: password hashes), storage\<bucket>\..., manifest.csv (SHA-256 of storage files)
  Restore: see docs\backup-restore.md
#>
param(
  [string]$OutDir = (Join-Path $HOME 'Documents\mithaq-backups'),
  [int]$KeepDays = 30,
  [switch]$SkipStorage
)
$ErrorActionPreference = 'Stop'
$ref = 'hmauemcowlaqujeatbaz'
$dbUrl = $env:MITHAQ_DB_URL
$svcKey = $env:MITHAQ_SERVICE_KEY
if (-not $dbUrl) { throw 'Set MITHAQ_DB_URL first (see the header of this script).' }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw 'pg_dump not found. Install PostgreSQL client tools and add them to PATH.' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dest = Join-Path $OutDir "mithaq-$stamp"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Backup folder: $dest"

# 1) public schema (structure + data)
& pg_dump --dbname=$dbUrl --schema=public --no-owner --no-privileges --file (Join-Path $dest 'public.sql')
if ($LASTEXITCODE -ne 0) { throw 'pg_dump (public) failed' }

# 2) accounts (needed to restore logins) - sensitive, keep this file protected
& pg_dump --dbname=$dbUrl --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities --file (Join-Path $dest 'auth-users.sql')
if ($LASTEXITCODE -ne 0) { throw 'pg_dump (auth) failed' }

# 3) storage files
if (-not $SkipStorage) {
  if (-not $svcKey) { throw 'Set MITHAQ_SERVICE_KEY or pass -SkipStorage.' }
  $base = "https://$ref.supabase.co/storage/v1"
  $h = @{ apikey = $svcKey; Authorization = "Bearer $svcKey" }
  $buckets = Invoke-RestMethod -Headers $h -Uri "$base/bucket"
  $count = 0
  foreach ($b in $buckets) {
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue('')
    while ($queue.Count -gt 0) {
      $prefix = $queue.Dequeue()
      $offset = 0
      do {
        $body = @{ prefix = $prefix; limit = 1000; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Depth 4
        $items = Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' -Uri "$base/object/list/$($b.name)" -Body $body
        foreach ($it in $items) {
          $path = if ($prefix) { "$prefix/$($it.name)" } else { $it.name }
          if ($null -eq $it.id) { $queue.Enqueue($path); continue }   # folder
          $local = Join-Path (Join-Path $dest "storage\$($b.name)") ($path -replace '/', '\')
          New-Item -ItemType Directory -Force -Path (Split-Path $local) | Out-Null
          $enc = ($path -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
          Invoke-WebRequest -Headers $h -Uri "$base/object/$($b.name)/$enc" -OutFile $local -UseBasicParsing
          $count++
        }
        $offset += 1000
      } while ($items.Count -eq 1000)
    }
  }
  Write-Host "Storage files saved: $count"
  # manifest.csv: path, size, SHA-256 for every storage file (used to verify a restore)
  $root = Join-Path $dest 'storage'
  if (Test-Path $root) {
    Get-ChildItem -Path $root -Recurse -File | ForEach-Object { [pscustomobject]@{ path = $_.FullName.Substring($root.Length + 1); bytes = $_.Length; sha256 = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash } } | Export-Csv -NoTypeInformation -Encoding UTF8 -Path (Join-Path $dest 'manifest.csv')
    Write-Host 'Manifest written: manifest.csv'
  }
}

# 4) retention
Get-ChildItem -Path $OutDir -Directory -Filter 'mithaq-*' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object { Remove-Item -Recurse -Force $_.FullName; Write-Host "Removed old backup: $($_.Name)" }
Write-Host 'Done. Keep auth-users.sql in a protected location.'

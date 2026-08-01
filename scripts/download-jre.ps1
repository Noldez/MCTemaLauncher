# Downloads Eclipse Temurin JRE 21 (Windows x64) into assets/jre so it can be
# bundled into the installer. Minecraft 1.21.11 requires Java 21.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$jreDir = Join-Path $root "assets\jre"
$tmpZip = Join-Path $env:TEMP "temurin-jre-21.zip"
$tmpExt = Join-Path $env:TEMP "temurin-jre-21"

$url = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk"

Write-Host "Downloading Temurin JRE 21..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing

Write-Host "Extracting..." -ForegroundColor Cyan
if (Test-Path $tmpExt) { Remove-Item $tmpExt -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpExt -Force

# The zip contains a single top-level folder like "jdk-21.0.x+y-jre"
$inner = Get-ChildItem $tmpExt | Where-Object { $_.PSIsContainer } | Select-Object -First 1

if (Test-Path $jreDir) { Remove-Item $jreDir -Recurse -Force }
New-Item -ItemType Directory -Force $jreDir | Out-Null
Copy-Item (Join-Path $inner.FullName "*") $jreDir -Recurse -Force

Remove-Item $tmpZip -Force
Remove-Item $tmpExt -Recurse -Force

$javaExe = Join-Path $jreDir "bin\java.exe"
if (Test-Path $javaExe) {
  Write-Host "JRE ready at assets\jre" -ForegroundColor Green
  & $javaExe -version
} else {
  Write-Host "Something went wrong: java.exe not found." -ForegroundColor Red
}

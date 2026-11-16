# Build Octavia Windows installer (NSIS .exe)
# Prerequisites: Node.js, Python venv in backend\.venv

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"
$Backend = Join-Path $Root "backend"
$Desktop = Join-Path $Root "desktop"
$ServerOut = Join-Path $Desktop "resources\server"
$UiOut = Join-Path $Desktop "resources\ui"
$Py = Join-Path $Backend ".venv\Scripts\python.exe"

Write-Host "==> Octavia Windows installer build" -ForegroundColor Cyan
Write-Host "Root: $Root"

if (-not (Test-Path $Py)) {
  throw "Backend venv not found at $Py. Create it and install requirements first."
}

Write-Host ""
Write-Host "[1/5] Building frontend..." -ForegroundColor Yellow
Push-Location $Frontend
try {
  if (-not (Test-Path "node_modules")) { npm install }
  $env:VITE_API_BASE = "/api"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "[2/5] Copying UI into desktop resources..." -ForegroundColor Yellow
if (Test-Path $UiOut) { Remove-Item $UiOut -Recurse -Force }
New-Item -ItemType Directory -Path $UiOut -Force | Out-Null
Copy-Item -Path (Join-Path $Frontend "dist\*") -Destination $UiOut -Recurse -Force

Write-Host ""
Write-Host "[3/5] Packaging API server with PyInstaller..." -ForegroundColor Yellow
Push-Location $Backend
try {
  & $Py -m pip install --upgrade pip
  & $Py -m pip install pyinstaller
  if (Test-Path "dist\octavia-server") { Remove-Item "dist\octavia-server" -Recurse -Force }
  if (Test-Path "build\octavia-server") { Remove-Item "build\octavia-server" -Recurse -Force }
  & $Py -m PyInstaller --noconfirm "octavia-server.spec"
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
} finally {
  Pop-Location
}

if (Test-Path $ServerOut) { Remove-Item $ServerOut -Recurse -Force }
New-Item -ItemType Directory -Path $ServerOut -Force | Out-Null
Copy-Item -Path (Join-Path $Backend "dist\octavia-server\*") -Destination $ServerOut -Recurse -Force

Write-Host ""
Write-Host "[4/5] Installing Electron builder deps..." -ForegroundColor Yellow
Push-Location $Desktop
try {
  if (-not (Test-Path "node_modules")) { npm install }
  Write-Host ""
  Write-Host "[5/5] Creating Windows installer / portable exe..." -ForegroundColor Yellow
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  $env:ELECTRON_BUILDER_DISABLE_SIGNING = "true"
  npm run dist
  if ($LASTEXITCODE -ne 0) {
    Write-Host "NSIS failed; building portable exe only..." -ForegroundColor DarkYellow
    npx electron-builder --win portable --x64
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
  }
} finally {
  Pop-Location
}

$Release = Join-Path $Desktop "release"
Write-Host ""
Write-Host "Done. Installer(s):" -ForegroundColor Green
Get-ChildItem $Release -Filter "*.exe" | ForEach-Object { Write-Host (" - " + $_.FullName) -ForegroundColor Green }
Write-Host ""
Write-Host "Install notes:"
Write-Host " 1. Start XAMPP MySQL (database octavia_production)."
Write-Host " 2. Run the installer .exe."
Write-Host " 3. Launch Octavia Production from the Start Menu / Desktop shortcut."
Write-Host ' 4. Edit %APPDATA%\Octavia Production\.env if your DB credentials differ.'

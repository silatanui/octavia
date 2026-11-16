const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const API_HOST = '127.0.0.1'
const API_PORT = Number(process.env.OCTAVIA_PORT || 17800)
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`

let mainWindow = null
let serverProcess = null
let shuttingDown = false

function resourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return path.join(__dirname, 'resources')
}

function serverPaths() {
  const root = resourcesRoot()
  const packagedExe = path.join(root, 'server', 'octavia-server.exe')
  const uiDir = path.join(root, 'ui')
  const envTemplate = path.join(root, 'env', '.env')
  const userData = app.getPath('userData')
  const envFile = path.join(userData, '.env')
  return { packagedExe, uiDir, envTemplate, envFile, userData }
}

function ensureEnvFile() {
  const { envTemplate, envFile, userData } = serverPaths()
  fs.mkdirSync(userData, { recursive: true })
  if (!fs.existsSync(envFile) && fs.existsSync(envTemplate)) {
    fs.copyFileSync(envTemplate, envFile)
  }
  return envFile
}

function waitForHealth(timeoutMs = 45000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${API_ORIGIN}/health`, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
          return
        }
        retry()
      })
      req.on('error', retry)
      req.setTimeout(2000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Octavia API did not become ready in time.'))
        return
      }
      setTimeout(tick, 400)
    }
    tick()
  })
}

function startServer() {
  const { packagedExe, uiDir, envFile } = serverPaths()
  ensureEnvFile()

  const args = [
    '--host',
    API_HOST,
    '--port',
    String(API_PORT),
    '--static-dir',
    uiDir,
    '--env-file',
    envFile,
  ]

  if (fs.existsSync(packagedExe)) {
    serverProcess = spawn(packagedExe, args, {
      cwd: path.dirname(packagedExe),
      windowsHide: true,
      env: {
        ...process.env,
        OCTAVIA_STATIC_DIR: uiDir,
        OCTAVIA_ENV_FILE: envFile,
      },
    })
  } else {
    // Dev fallback: run Python entry from the repo backend
    const backendDir = path.join(__dirname, '..', 'backend')
    const py = process.env.OCTAVIA_PYTHON || path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    const script = path.join(backendDir, 'desktop_run.py')
    if (!fs.existsSync(py) || !fs.existsSync(script)) {
      throw new Error(
        'Desktop server binary missing. Run scripts\\build-windows-installer.ps1 first (or start backend .venv).',
      )
    }
    serverProcess = spawn(py, [script, ...args], {
      cwd: backendDir,
      windowsHide: true,
      env: {
        ...process.env,
        OCTAVIA_STATIC_DIR: uiDir,
        OCTAVIA_ENV_FILE: envFile,
      },
    })
  }

  serverProcess.stdout?.on('data', (buf) => {
    if (!app.isPackaged) process.stdout.write(buf)
  })
  serverProcess.stderr?.on('data', (buf) => {
    if (!app.isPackaged) process.stderr.write(buf)
  })
  serverProcess.on('exit', (code) => {
    serverProcess = null
    if (!shuttingDown && mainWindow) {
      dialog.showErrorBox(
        'Octavia server stopped',
        `The local API exited (code ${code ?? '?'}).\n\nCheck that MySQL/XAMPP is running and that %APPDATA%\\Octavia Production\\.env points at your database.`,
      )
    }
  })
}

function stopServer() {
  if (!serverProcess) return
  shuttingDown = true
  try {
    serverProcess.kill()
  } catch {
    /* ignore */
  }
  serverProcess = null
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Octavia Production',
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(API_ORIGIN)
}

async function boot() {
  try {
    // Ensure UI exists for packaged + local resource builds
    const { uiDir } = serverPaths()
    if (!fs.existsSync(path.join(uiDir, 'index.html'))) {
      throw new Error(
        `UI build missing at:\n${uiDir}\n\nRun scripts\\build-windows-installer.ps1 to prepare resources.`,
      )
    }
    startServer()
    await waitForHealth()
    await createWindow()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox('Octavia failed to start', message)
    stopServer()
    app.quit()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(boot)

  app.on('before-quit', () => {
    stopServer()
  })

  app.on('window-all-closed', () => {
    stopServer()
    if (process.platform !== 'darwin') app.quit()
  })
}

import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { app as electronApp } from 'electron'
import { fileURLToPath } from 'node:url'
import { createRecordParser } from './frame-protocol.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const helperPath = resolve(electronApp.isPackaged ? process.resourcesPath : resolve(here, '../..'), 'native/macos-capture-probe/build/multicast-capture')
let mainWindow
let helper
let captureStart

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    webPreferences: { preload: resolve(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(resolve(here, '../dist/index.html'))
  mainWindow.on('closed', () => { mainWindow = undefined; stopHelper() })
}

function stopHelper() {
  if (helper && helper.exitCode === null) {
    helper.stdin.end()
    helper.kill('SIGTERM')
  }
  helper = undefined
  captureStart = undefined
}

ipcMain.handle('capture:list-displays', async () => {
  if (process.platform !== 'darwin') throw new Error('Native ScreenCaptureKit capture is available only on macOS.')
  try {
    const { stdout } = await execFileAsync(helperPath, ['--list-displays'], { timeout: 15000, maxBuffer: 1024 * 1024 })
    const result = JSON.parse(stdout)
    return result.displays
  } catch (error) {
    const detail = error.stderr?.trim() || error.message
    throw new Error(`Could not list shareable displays. Allow Screen Recording for MultiCast 6 in System Settings → Privacy & Security → Screen Recording, then restart the app. (${detail})`, { cause: error })
  }
})

ipcMain.handle('capture:start', async (_event, displayId) => {
  if (process.platform !== 'darwin') throw new Error('Native ScreenCaptureKit capture is available only on macOS.')
  if (!Number.isInteger(displayId) || displayId < 0) throw new Error('Choose a valid display first.')
  stopHelper()
  try {
    helper = spawn(helperPath, ['--capture', String(displayId)], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`Could not start native capture helper: ${error.message}`, { cause: error })
  }
  captureStart = {}
  let helperStderr = ''
  const starting = new Promise((resolveStart, rejectStart) => {
    captureStart.resolve = resolveStart
    captureStart.reject = rejectStart
    const parse = createRecordParser((type, payload) => {
      if (type === 1) mainWindow?.webContents.send('capture:frame', payload)
      if (type === 2) {
        let status
        try { status = JSON.parse(payload.toString()) } catch { status = { type: 'error', message: 'Invalid response from native capture helper.' } }
        if (status.type === 'started' && captureStart) {
          captureStart.started = true
          captureStart.resolve?.()
        }
        if (status.type === 'error') captureStart?.reject?.(new Error(status.message))
        mainWindow?.webContents.send('capture:status', status)
      }
    })
    helper.stdout.on('data', (chunk) => {
      try { parse(chunk) } catch (error) { captureStart?.reject?.(error); stopHelper() }
    })
    helper.stderr.on('data', (chunk) => {
      helperStderr = `${helperStderr}${chunk.toString()}`.slice(-4000)
      console.error(`[ScreenCaptureKit] ${chunk.toString().trim()}`)
    })
    helper.once('error', (error) => {
      const message = `Could not start native capture helper: ${error.message}`
      captureStart?.reject?.(new Error(message))
      mainWindow?.webContents.send('capture:status', { type: 'error', message })
    })
    helper.once('exit', (code) => {
      if (captureStart) {
        const details = helperStderr.trim()
        const message = code
          ? `Native capture helper stopped with exit code ${code}.${details ? ` Details: ${details}` : ' Check Screen Recording permission and try again.'}`
          : 'Native capture helper exited before confirming that capture started.'
        if (!captureStart.started) captureStart.reject(new Error(message))
        else if (code !== 0) mainWindow?.webContents.send('capture:status', { type: 'error', message })
        else mainWindow?.webContents.send('capture:status', { type: 'stopped', message: 'Native capture helper stopped.' })
      }
      helper = undefined
      captureStart = undefined
    })
  })
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for ScreenCaptureKit. Check Screen Recording permission.')), 15000))
  try { await Promise.race([starting, timeout]) } catch (error) { stopHelper(); throw error }
  return { started: true }
})

ipcMain.handle('capture:stop', () => { stopHelper(); return { stopped: true } })
app.whenReady().then(createWindow)
app.on('before-quit', stopHelper)
app.on('window-all-closed', () => app.quit())

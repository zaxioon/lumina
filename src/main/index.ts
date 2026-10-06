import { app, BrowserWindow, ipcMain, nativeTheme, protocol, shell } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc'
import { registerMediaProtocol } from './ipc/imageHandlers'
import { buildMenu } from './menu'
import { applyWindowState, trackWindowState } from './windowState'
import { initUpdater } from './updater'
import { IPC } from '../renderer/src/types/ipc'

let mainWindow: BrowserWindow | null = null
let pendingOpenPath: string | null = null
let allowClose = false
let closePending = false
// Last spell-check data captured from the native context-menu event
let lastSpellData: { misspelledWord: string; suggestions: string[] } = {
  misspelledWord: '',
  suggestions: []
}
// Tracks whether the window close was triggered by Cmd+Q / app.quit()
// so we can call app.quit() again after our async dialog finishes.
let isQuitting = false

// Must be registered before app.on('ready') on macOS
app.on('open-file', (event, path) => {
  event.preventDefault()
  pendingOpenPath = path
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.PUSH_OPEN_FILE, path)
  }
})

// Set the quitting flag as early as possible so the close handler can read it.
app.on('before-quit', () => {
  isQuitting = true
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, standard: true, bypassCSP: true } }
])

function createWindow(): void {
  allowClose = false
  closePending = false
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  // Reset per-window flags
  allowClose = false
  isQuitting = false

  // Resolve icon relative to the app root (works both in dev and after packaging)
  const appRoot = app.isPackaged ? join(__dirname, '../../..') : join(__dirname, '../../..')
  const iconPath = isWin
    ? join(appRoot, 'build/icon.ico')
    : isMac
    ? join(appRoot, 'build/icon.icns')
    : join(appRoot, 'build/icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    frame: !isMac,
    backgroundColor: '#ffffff',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    },
    show: false
  })

  applyWindowState(mainWindow)
  trackWindowState(mainWindow)

  // Capture OS spell-check data so the renderer can include suggestions in its custom context menu
  mainWindow.webContents.on('context-menu', (_e, params) => {
    lastSpellData = {
      misspelledWord: params.misspelledWord ?? '',
      suggestions: params.dictionarySuggestions ?? []
    }
  })

  // Redirect all window.open / target=_blank calls to the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    if (pendingOpenPath) {
      mainWindow!.webContents.send(IPC.PUSH_OPEN_FILE, pendingOpenPath)
      pendingOpenPath = null
    }
    // Only check for updates in packaged builds — not during development
    if (app.isPackaged) initUpdater(mainWindow!)
  })

  // Null out the reference once the window is fully gone so isDestroyed()
  // checks elsewhere don't need to be the last line of defence.
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    if (closePending || !mainWindow || mainWindow.isDestroyed()) return
    closePending = true
    // The renderer owns all tab states. It acknowledges only after every save/decision completes.
    mainWindow.webContents.send(IPC.PUSH_REQUEST_CLOSE)
  })

  buildMenu(mainWindow)

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Register all IPC handlers once — NOT inside createWindow()
  registerAllHandlers()
  registerMediaProtocol()

  // Spell-check — renderer asks for the last captured OS suggestions
  ipcMain.handle('spell:get-suggestions', () => lastSpellData)

  // Renderer picked a suggestion — use Chromium's built-in replaceMisspelling
  ipcMain.on('spell:replace', (_e, word: string) => {
    mainWindow?.webContents.replaceMisspelling(word)
  })

  // shell:open-external — used by the renderer for link clicks
  ipcMain.handle('shell:open-external', async (_, url: string) => {
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Unsupported external link.')
    await shell.openExternal(url)
  })

  ipcMain.on(IPC.WINDOW_CLOSE_RESULT, (event, allowed: boolean) => {
    if (!closePending || !mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
    closePending = false
    if (allowed !== true) { isQuitting = false; return }
    allowClose = true
    mainWindow?.close()
    if (isQuitting) app.quit()
  })

  // Push OS theme changes to the renderer
  nativeTheme.on('updated', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PUSH_THEME_CHANGE, theme)
    }
  })

  createWindow()

  // macOS: re-create window when clicking dock icon with no windows open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

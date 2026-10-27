/**
 * Electron's modules, stood in for in the main process's tests: vitest's
 * config points `electron` and `electron-updater` here, so the tests run
 * without Electron installed. Each test sets what it needs.
 */
import { vi } from 'vitest'

export const app = {
  isPackaged: false,
  getPath: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  dock: { setMenu: vi.fn() },
}
export const ipcMain = { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
export const net = { fetch: vi.fn() }
export const protocol = { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
export const shell = { openExternal: vi.fn(), trashItem: vi.fn(), showItemInFolder: vi.fn() }
export const dialog = { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }
export const BrowserWindow = Object.assign(vi.fn(), {
  fromWebContents: vi.fn(),
  getFocusedWindow: vi.fn(),
})
export const Menu = { buildFromTemplate: vi.fn(template => template), setApplicationMenu: vi.fn() }
export const clipboard = { writeText: vi.fn() }
export const session = { fromPartition: vi.fn(), defaultSession: {} }
export const WebContentsView = vi.fn()
export const MessageChannelMain = vi.fn()

export const autoUpdater = {
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}
export default { autoUpdater }

/**
 * Electron's modules, stood in for in the main process's tests: vitest's
 * config points `electron` and `electron-updater` here, so the tests run
 * without Electron installed. Each test sets what it needs.
 */
import { vi } from 'vitest'

export const app = { isPackaged: false, getPath: vi.fn() }
export const ipcMain = { handle: vi.fn(), on: vi.fn() }
export const net = { fetch: vi.fn() }
export const protocol = { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
export const shell = { openExternal: vi.fn(), trashItem: vi.fn(), showItemInFolder: vi.fn() }
export const dialog = { showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
export const BrowserWindow = { fromWebContents: vi.fn() }

export const autoUpdater = {
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}
export default { autoUpdater }

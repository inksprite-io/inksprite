/**
 * @module platform/desktop
 * @description Whether the app is running in its desktop window.
 */

/**
 * Whether the app is running in its desktop window.
 *
 * Decided at runtime, not when the app is built: in development the browser
 * tab and the window load the same bundle from the same server.
 *
 * @returns {boolean}
 */
export const isDesktop = () => '__TAURI_INTERNALS__' in globalThis

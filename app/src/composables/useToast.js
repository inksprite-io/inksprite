/**
 * Toast notification composable
 * Wrapper around PrimeVue's toast service for showing notifications
 */

import { useToast as usePrimeToast } from 'primevue/usetoast'

export const useToast = () => {
  const primeToast = usePrimeToast()

  /**
   * Show a toast notification
   * @param {Object} options - Toast options
   * @param {string} options.message - The message to display
   * @param {string} [options.title] - Optional title
   * @param {string} [options.type='info'] - Toast type: 'success', 'error', 'warning', 'info'
   * @param {number} [options.duration=5000] - Duration in milliseconds (0 for permanent)
   * @param {boolean} [options.dismissible=true] - Whether the toast can be dismissed
   */
  const showToast = options => {
    const severity = options.type || 'info'
    const life = options.duration === 0 ? null : options.duration || 5000

    primeToast.add({
      severity,
      summary: options.title,
      detail: options.message,
      life,
      closable: options.dismissible !== false,
    })
  }

  /**
   * Show a success toast
   * @param {string} message - The message to display
   * @param {Object} [options] - Additional options
   */
  const success = (message, options = {}) => {
    primeToast.add({
      severity: 'success',
      summary: options.title,
      detail: message,
      life: options.duration || 5000,
      closable: options.dismissible !== false,
    })
  }

  /**
   * Show an error toast
   * @param {string} message - The message to display
   * @param {Object} [options] - Additional options
   */
  const error = (message, options = {}) => {
    primeToast.add({
      severity: 'error',
      summary: options.title,
      detail: message,
      life: options.duration || 8000, // Errors show longer by default
      closable: options.dismissible !== false,
    })
  }

  /**
   * Show a warning toast
   * @param {string} message - The message to display
   * @param {Object} [options] - Additional options
   */
  const warning = (message, options = {}) => {
    primeToast.add({
      severity: 'warn',
      summary: options.title,
      detail: message,
      life: options.duration || 5000,
      closable: options.dismissible !== false,
    })
  }

  /**
   * Show an info toast
   * @param {string} message - The message to display
   * @param {Object} [options] - Additional options
   */
  const info = (message, options = {}) => {
    primeToast.add({
      severity: 'info',
      summary: options.title,
      detail: message,
      life: options.duration || 5000,
      closable: options.dismissible !== false,
    })
  }

  /**
   * Show a toast with something to do about it — an Undo, usually. It stays a
   * little longer than a notice, so there is time to take it up.
   * @param {string} message - The message to display
   * @param {{label: string, command: () => void}} action - The button and what it does
   * @param {Object} [options] - Additional options
   * @param {import('@/utils/lineDiff.js').LineChange[]} [options.changes] - The lines
   *   it changed, offered under "What changed?"
   * @param {number} [options.duration]
   * @param {boolean} [options.dismissible]
   */
  const action = (message, action, options = {}) => {
    primeToast.add({
      severity: 'info',
      detail: message,
      life: options.duration || 8000,
      closable: options.dismissible !== false,
      action,
      changes: options.changes,
    })
  }

  return {
    showToast,
    action,
    success,
    error,
    warning,
    info,
  }
}

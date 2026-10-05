/**
 * Simple localStorage wrapper with JSON serialization support
 *
 * @module utils/localStorage
 */

/**
 * localStorage utility for managing application state persistence
 */
export const localStorage = {
  /**
   * Get a value from localStorage
   * @template T
   * @param {string} key - The storage key
   * @param {T} [defaultValue=null] - Default value if key doesn't exist
   * @returns {T} The stored value or defaultValue
   */
  get(key, defaultValue = null) {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch (error) {
      console.error(`Failed to parse localStorage item "${key}":`, error)
      return defaultValue
    }
  },

  /**
   * Set a value in localStorage
   * @param {string} key - The storage key
   * @param {*} value - The value to store (will be JSON stringified)
   * @returns {boolean} Success status
   */
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (error) {
      console.error(`Failed to set localStorage item "${key}":`, error)
      return false
    }
  },

  /**
   * Remove an item from localStorage
   * @param {string} key - The storage key
   * @returns {boolean} Success status
   */
  remove(key) {
    try {
      window.localStorage.removeItem(key)
      return true
    } catch (error) {
      console.error(`Failed to remove localStorage item "${key}":`, error)
      return false
    }
  },
}

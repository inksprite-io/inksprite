/**
 * Simple sessionStorage wrapper with JSON serialization support
 *
 * @module utils/sessionStorage
 */

/**
 * sessionStorage utility for managing temporary state persistence
 */
export const sessionStorage = {
  /**
   * Get a value from sessionStorage
   * @template T
   * @param {string} key - The storage key
   * @param {T} [defaultValue=null] - Default value if key doesn't exist
   * @returns {T} The stored value or defaultValue
   */
  get(key, defaultValue = null) {
    try {
      const item = window.sessionStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch (error) {
      console.error(`Failed to parse sessionStorage item "${key}":`, error)
      return defaultValue
    }
  },

  /**
   * Set a value in sessionStorage
   * @param {string} key - The storage key
   * @param {*} value - The value to store (will be JSON stringified)
   * @returns {boolean} Success status
   */
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (error) {
      console.error(`Failed to set sessionStorage item "${key}":`, error)
      return false
    }
  },

  /**
   * Remove an item from sessionStorage
   * @param {string} key - The storage key
   * @returns {boolean} Success status
   */
  remove(key) {
    try {
      window.sessionStorage.removeItem(key)
      return true
    } catch (error) {
      console.error(`Failed to remove sessionStorage item "${key}":`, error)
      return false
    }
  },
}

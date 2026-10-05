import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Composable that provides a reactive current time that updates periodically
 * This allows relative time displays to update automatically without page refresh
 *
 * @param {number} [updateInterval=60000] - Update interval in milliseconds (default: 1 minute)
 * @returns {{
 *   now: import('vue').Ref<number>,
 *   formatRelativeTime: (timestamp: number) => string
 * }}
 */
export function useReactiveTime(updateInterval = 60000) {
  const now = ref(Date.now())
  let intervalId = null

  /**
   * Format a timestamp as relative time using the reactive 'now' value
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {string} Formatted relative time string
   */
  const formatRelativeTime = timestamp => {
    const date = new Date(timestamp)
    const currentTime = new Date(now.value)
    const diffMs = currentTime.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  onMounted(() => {
    // Update the current time periodically
    intervalId = window.setInterval(() => {
      now.value = Date.now()
    }, updateInterval)
  })

  onUnmounted(() => {
    // Clean up the interval when component unmounts
    if (intervalId) {
      window.clearInterval(intervalId)
      intervalId = null
    }
  })

  return {
    now,
    formatRelativeTime,
  }
}

/**
 * Format thinking/reasoning time duration
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration string (e.g., "2.5s", "1.2s")
 */
export function formatThinkingTime(milliseconds) {
  if (!milliseconds || milliseconds < 0) return ''

  const seconds = milliseconds / 1000

  // For very short durations
  if (seconds < 0.1) return '<0.1s'

  // Round to 1 decimal place
  if (seconds < 10) return `${seconds.toFixed(1)}s`

  // Round to whole seconds for longer durations
  return `${Math.round(seconds)}s`
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted relative time string
 */
export function formatRelativeTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
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

/** How much of a tool's result is shown before it is cut short. */
const TOOL_RESULT_PREVIEW_LIMIT = 600

/**
 * A tool call's arguments, compactly, for the line naming the call. Strings
 * stay quoted; other values stringify; an object shows its fields as
 * `key: value`.
 *
 * @param {any} args - Parsed, or the raw text when it did not parse
 * @returns {string}
 */
export function formatToolArguments(args) {
  if (args == null) return ''
  if (typeof args === 'string') return JSON.stringify(args)
  if (typeof args !== 'object') return String(args)
  return Object.entries(args)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
}

/** How much of a run of Python's output is shown before it is cut short: a table's worth. */
const PYTHON_RESULT_PREVIEW_LIMIT = 4000

/**
 * A run of Python's result for display, as it came: what it printed, the
 * value of its last line, and its traceback, rather than the JSON the model
 * read them in. Cut short when it is long.
 *
 * @param {string} content - The result as the model was sent it
 * @returns {string}
 */
export function formatPythonResult(content) {
  let result
  try {
    result = JSON.parse(content)
  } catch {
    return formatToolResult(content)
  }
  if (!result || typeof result !== 'object') return formatToolResult(content)
  const shown = [result.stdout, result.stderr, result.value, result.error, result.restarted]
    .filter(part => typeof part === 'string' && part.trim())
    .map(part => part.replace(/\n+$/, ''))
    .join('\n')
  if (shown.length > PYTHON_RESULT_PREVIEW_LIMIT) {
    return (
      shown.slice(0, PYTHON_RESULT_PREVIEW_LIMIT) +
      `\n… (${shown.length - PYTHON_RESULT_PREVIEW_LIMIT} more chars)`
    )
  }
  return shown
}

/**
 * A tool's result for display: pretty-printed when it is JSON, and cut short
 * when it is long.
 *
 * @param {string} content
 * @returns {string}
 */
export function formatToolResult(content) {
  let pretty = content
  try {
    pretty = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    // Not JSON; leave as-is
  }
  if (pretty.length > TOOL_RESULT_PREVIEW_LIMIT) {
    return (
      pretty.slice(0, TOOL_RESULT_PREVIEW_LIMIT) +
      `\n… (${pretty.length - TOOL_RESULT_PREVIEW_LIMIT} more chars)`
    )
  }
  return pretty
}

import { ref, computed, watch } from 'vue'
import Fuse from 'fuse.js'

/**
 * @template T
 * @typedef {Object} SearchOptions
 * @property {Array<string|{name: string, weight?: number}>} keys - Fields to search
 * @property {number} [threshold=0.4] - Fuzzy match tolerance (0 = exact, 1 = match anything)
 * @property {number} [minMatchCharLength=2] - Minimum characters before searching
 * @property {boolean} [includeScore=true] - Include match scores in results
 * @property {boolean} [ignoreLocation=true] - Search anywhere in text
 * @property {number} [debounceMs=300] - Debounce time in milliseconds
 */

/**
 * @template T
 * @typedef {Object} SearchResult
 * @property {T} item - The original item
 * @property {number} [score] - Match score (lower is better)
 * @property {Object} [matches] - Match details
 */

/**
 * Composable for fuzzy searching with Fuse.js
 * @template T
 * @param {import('vue').Ref<T[]>|import('vue').ComputedRef<T[]>|(() => T[])} items - Items to search
 * @param {SearchOptions<T>} options - Search configuration
 * @returns {{
 *   searchQuery: import('vue').Ref<string>,
 *   searchResults: import('vue').ComputedRef<T[]>,
 *   isSearching: import('vue').ComputedRef<boolean>,
 *   hasResults: import('vue').ComputedRef<boolean>,
 *   resultCount: import('vue').ComputedRef<number>,
 *   clearSearch: () => void
 * }}
 */
export function useSearch(items, options) {
  const {
    keys = [],
    threshold = 0.3,
    minMatchCharLength = 2,
    includeScore = true,
    ignoreLocation = true,
    debounceMs = 200,
  } = options || {}

  // Search state
  const searchQuery = ref('')
  const debouncedQuery = ref('')
  let debounceTimer = null

  // Debounce search query
  watch(searchQuery, newQuery => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedQuery.value = newQuery
    }, debounceMs)
  })

  // Create Fuse instance
  const fuseInstance = computed(() => {
    const itemList = typeof items === 'function' ? items() : items.value
    if (!itemList || itemList.length === 0) return null

    const fuseOptions = {
      keys,
      threshold,
      includeScore,
      ignoreLocation,
      minMatchCharLength,
      shouldSort: true,
      findAllMatches: false,
      useExtendedSearch: false,
    }

    return new Fuse(itemList, fuseOptions)
  })

  // Perform search
  const searchResults = computed(() => {
    const itemList = typeof items === 'function' ? items() : items.value
    if (!itemList) return []

    const query = debouncedQuery.value.trim()

    // Return all items if no search query or query too short
    if (!query || query.length < minMatchCharLength) {
      return itemList
    }

    const fuse = fuseInstance.value
    if (!fuse) return []

    // Perform search and extract items
    const results = fuse.search(query)
    return results.map(result => result.item)
  })

  // Search status
  const isSearching = computed(() => {
    const query = debouncedQuery.value.trim()
    return query.length >= minMatchCharLength
  })

  const hasResults = computed(() => searchResults.value && searchResults.value.length > 0)

  const resultCount = computed(() => (searchResults.value ? searchResults.value.length : 0))

  // Clear search
  const clearSearch = () => {
    searchQuery.value = ''
    debouncedQuery.value = ''
  }

  return {
    searchQuery,
    searchResults,
    isSearching,
    hasResults,
    resultCount,
    clearSearch,
  }
}

/**
 * Strip HTML tags from text
 * @param {string} html - HTML string to strip
 * @returns {string} Plain text
 */
export function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').trim()
}

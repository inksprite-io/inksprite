/* global AbortController */
/**
 * @module composables/useAISummarize
 * @description Composable for AI-powered content summarization. Handles generating
 * summaries for chapters/scenes using the AI service with a specialized summarization template.
 *
 * @example
 * const { handleSummarize, isGenerating, stopGeneration } = useAISummarize()
 *
 * // Generate summary for a chapter
 * const summary = await handleSummarize(storyId, documentId, (chunk) => console.log(chunk))
 */

/**
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 * @typedef {import('../types/models.js').Scene} Scene
 */

import { ref } from 'vue'
import { useAIConfig } from './useAIConfig.js'
import { useAIService } from './useAIService.js'
import { useAIContext } from './useAIContext.js'
import { stripMarkdown } from '../utils/markdown.js'
import { useDocumentsStore } from '../stores/documentsStore.js'
import { ProviderNotConfiguredError } from '@/utils/errors.js'
import summarizePrompt from '@/ai/prompts/summarize.md?raw'
import summarizeUserPrompt from '@/ai/prompts/summarize-user.md?raw'
import { connectionGap } from '@/ai/providers.js'

const DEFAULT_SUMMARIZE_PROMPT = summarizePrompt.trim()
const DEFAULT_SUMMARIZE_USER_PROMPT = summarizeUserPrompt.trim()

/**
 * Module-level state (singleton)
 */
const isGenerating = ref(false)
const currentGeneration = ref(null)
/** The summary being written, to stop. @type {AbortController|null} */
let controller = null

/**
 * AI summarization service
 * This is a singleton composable - all instances share the same state
 *
 * @returns {{
 *   isGenerating: import('vue').Ref<boolean>,
 *   handleSummarize: (storyId: string, documentId: string, onChunk?: (chunk: string) => void) => Promise<string>,
 *   stopGeneration: () => void
 * }}
 */
export function useAISummarize() {
  const aiConfig = useAIConfig()
  const aiService = useAIService()
  const documentsStore = useDocumentsStore()

  /**
   * Check if AI is properly configured
   * @returns {AIPreset} The active AI profile if configured
   * @throws {ProviderNotConfiguredError} If provider is not properly configured
   * @throws {Error} If other configuration issues exist
   */
  const getWriteProfileIfValid = () => {
    const profile = aiConfig.activeAIPreset.value
    if (!profile || !profile.providerId) {
      throw new ProviderNotConfiguredError('Set up a provider to use AI features.')
    }

    const provider = aiConfig.getProvider(profile.providerId)
    if (!provider) {
      throw new ProviderNotConfiguredError('Set up a provider to use AI features.')
    }

    if (!profile.model) {
      throw new Error('Select a model in the settings menu.')
    }

    const gap = connectionGap(provider)
    if (gap === 'key') {
      throw new ProviderNotConfiguredError('Enter your OpenRouter API key to use AI features.')
    }
    if (gap === 'endpoint') {
      throw new Error('You need to provide a provider endpoint in the settings menu.')
    }

    return profile
  }

  /**
   * Get the content of a scene
   * @param {string} documentId - The scene ID
   * @returns {string} The scene content as plain text
   */
  const getSceneContent = documentId => {
    const scene = documentsStore.getDocument(documentId)
    if (!scene || !scene.content) {
      return ''
    }
    // Without its syntax, so that a document holding only a rule or a
    // heading marker reads as the nothing it is.
    return stripMarkdown(scene.content)
  }

  /**
   * Generate a summary for a scene/chapter
   * @param {string} storyId - The story ID
   * @param {string} documentId - Scene ID to summarize
   * @param {(chunk: string) => void} [onChunk] - Optional callback for streaming chunks
   * @returns {Promise<string>} The generated summary
   */
  const handleSummarize = async (storyId, documentId, onChunk) => {
    if (isGenerating.value) {
      throw new Error("Can't start a new generation while one is in progress.")
    }

    const profile = getWriteProfileIfValid() // Will throw if invalid

    // Get the scene content
    const sceneContent = getSceneContent(documentId)
    if (!sceneContent || sceneContent.trim().length === 0) {
      throw new Error('No content to summarize. The chapter appears to be empty.')
    }

    const own = new AbortController()
    controller = own

    try {
      isGenerating.value = true

      // Track generation start
      currentGeneration.value = {
        documentId,
        timestamp: Date.now(),
      }

      let fullContent = ''

      // Common chunk handler for both text and chat completions
      const handleChunk = chunkContent => {
        fullContent += chunkContent
        // Call the streaming callback if provided
        if (onChunk) {
          onChunk(chunkContent)
        }
      }

      const aiContext = useAIContext(storyId)
      const contextResult = await aiContext.build({
        mode: 'summarize',
        systemPrompt: DEFAULT_SUMMARIZE_PROMPT,
        userPrompt: DEFAULT_SUMMARIZE_USER_PROMPT,
        documentId: documentId,
      })

      try {
        await aiService.generateChatCompletion(
          contextResult.messages,
          profile,
          chunkData => handleChunk(chunkData.content || ''),
          { signal: own.signal }
        )
      } catch (error) {
        // Stopped, what arrived is the summary so far, and is kept.
        if (!own.signal.aborted) throw error
      }

      // Clean up the summary - remove any markdown formatting
      const cleanSummary = stripMarkdown(fullContent).trim()

      currentGeneration.value = null
      return cleanSummary
    } catch (error) {
      console.error('Failed to generate summary:', error)
      throw error
    } finally {
      // Stopped, another summary may have started since.
      if (controller === own) {
        controller = null
        isGenerating.value = false
      }
    }
  }

  /**
   * Stop streaming generation
   */
  const stopGeneration = () => {
    console.log('Stopping AI generation...')
    controller?.abort()
    controller = null
    isGenerating.value = false
    currentGeneration.value = null
  }

  return {
    // State
    isGenerating,

    // Methods
    handleSummarize,
    stopGeneration,
  }
}

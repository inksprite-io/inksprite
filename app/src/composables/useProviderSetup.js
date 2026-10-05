/**
 * @module composables/useProviderSetup
 * @description Composable for managing the provider setup dialog
 *
 * @example
 * const { showProviderSetupDialog, handleProviderConnect } = useProviderSetup()
 *
 * // Show the dialog when provider is not configured
 * showProviderSetupDialog()
 */

import { ref } from 'vue'
import { useAIConfig } from './useAIConfig'
import { useApplicationState } from './useApplicationState'

const DEFAULT_OPENROUTER_PROVIDER_ID = 'provider_openrouter_default'

// Global state for dialog visibility (shared across all instances)
const providerSetupDialogVisible = ref(false)

/**
 * Composable for managing provider setup dialog
 *
 * @returns {{
 *   providerSetupDialogVisible: import('vue').Ref<boolean>,
 *   showProviderSetupDialog: () => void,
 *   hideProviderSetupDialog: () => void,
 *   handleProviderConnect: (data: {apiKey: string, rememberKey: boolean}) => Promise<void>,
 *   handleDontShowAgain: () => void,
 *   isProviderSetupDialogEnabled: () => boolean
 * }}
 */
export function useProviderSetup() {
  const aiConfig = useAIConfig()
  const appState = useApplicationState()

  /**
   * Check if the provider setup dialog is enabled
   * @returns {boolean}
   */
  function isProviderSetupDialogEnabled() {
    return appState.getShowProviderSetupDialog()
  }

  /**
   * Show the provider setup dialog
   */
  function showProviderSetupDialog() {
    providerSetupDialogVisible.value = true
  }

  /**
   * Hide the provider setup dialog
   */
  function hideProviderSetupDialog() {
    providerSetupDialogVisible.value = false
  }

  /**
   * Handle the connect action from the provider setup dialog
   * @param {{apiKey: string, rememberKey: boolean}} data
   */
  async function handleProviderConnect(data) {
    const { apiKey, rememberKey } = data

    // Save the API key to the default provider
    if (apiKey) {
      const defaultProvider = aiConfig.getProvider(DEFAULT_OPENROUTER_PROVIDER_ID)
      if (defaultProvider) {
        await aiConfig.updateProvider(DEFAULT_OPENROUTER_PROVIDER_ID, {
          apiKey: apiKey,
          rememberKey: rememberKey,
        })
      }
    }

    // Hide the dialog
    hideProviderSetupDialog()
  }

  /**
   * Handle the "don't show again" action
   */
  function handleDontShowAgain() {
    appState.setShowProviderSetupDialog(false)
    hideProviderSetupDialog()
  }

  return {
    providerSetupDialogVisible,
    showProviderSetupDialog,
    hideProviderSetupDialog,
    handleProviderConnect,
    handleDontShowAgain,
    isProviderSetupDialogEnabled,
  }
}

/**
 * Setting up the AI in the capture scripts, as a first visit does: from the
 * chat's Connect, through setup.
 */

/**
 * Set up the AI as a first visit does, from the chat's Connect: choose the
 * provider, give it a key, connect, then choose a model and finish.
 *
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./capture.js').helpers>} ui
 * @param {{ provider: string, key?: string, model: string }} setup - The
 *   provider and the model as their lists name them
 */
export async function setUpAI(page, ui, { provider, key, model }) {
  await ui.click(page.getByRole('button', { name: 'Connect', exact: true }))
  const setup = page.getByRole('dialog', { name: 'Connect an AI provider' })
  await setup.waitFor()
  await ui.click(setup.locator('[data-field="kind"]'))
  await ui.click(page.getByRole('option', { name: provider, exact: true }))
  if (key) await ui.paste(setup.getByRole('textbox', { name: 'API key' }), key)
  await ui.click(setup.getByRole('button', { name: 'Connect', exact: true }))
  await setup.locator('[data-state="connected"]').waitFor()
  await ui.click(setup.getByRole('button', { name: 'Next' }))
  const models = page.getByRole('dialog', { name: 'Choose a model' })
  // A model's card, by its name: the first, where Recommended lists it too.
  await ui.click(models.locator('[data-card-toggle]').filter({ hasText: model }).first())
  await ui.click(models.getByRole('button', { name: 'Done' }))
  await models.waitFor({ state: 'hidden' })
}

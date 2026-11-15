/**
 * A writer at the app, for sync's flows: what one does in the page, by the
 * names and marks the app gives its controls.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** The code the flows' server makes accounts with. */
export const SIGNUP_CODE = 'flows'

/** Every account's passphrase. */
export const PASSPHRASE = 'a passphrase only the flows know'

/** How long anything that has to reach the server and come back may take. */
const SYNCED = 20_000

/**
 * @param {import('playwright').BrowserContext} context
 * @param {{app: string, server: string, name: string, shots: string, label?: string}} options
 */
export async function makeWriter(context, { app, server, name, shots, label = name }) {
  const page = await context.newPage()
  page.setDefaultTimeout(SYNCED)
  /** What the page logged as errors, for a failure to show. @type {string[]} */
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))

  const button = (/** @type {string} */ text) =>
    page.getByRole('button', { name: text, exact: true })
  const dialog = (/** @type {string} */ text) => page.getByRole('dialog', { name: text })
  const settings = dialog('Settings')

  await page.goto(app)
  await dialog('Welcome').waitFor()
  await button('Start writing').click()
  await dialog('Welcome').waitFor({ state: 'hidden' })

  /** A picture of the page, for looking at a flow. @param {string} title */
  const shot = async title => {
    await mkdir(shots, { recursive: true })
    await page.screenshot({ path: join(shots, `${label}-${title}.png`) })
  }

  /**
   * Settings at a section, and a part of it.
   * @param {string} section @param {string} [part]
   */
  const openSettings = async (section, part) => {
    if (!(await settings.isVisible())) await button('Settings').click()
    await settings.locator(`[data-section="${section}"]`).click()
    if (part) await settings.locator(`[data-section-parts] [data-part="${part}"]`).first().click()
  }
  const closeSettings = async () => {
    if (await settings.isVisible()) await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })
  }

  /** Fill the sign-in form. @param {'Sign in'|'Create account'|'Recover'} mode */
  const account = async mode => {
    await openSettings('sync', 'account')
    await settings.locator('[data-field="sync-mode"]').getByText(mode, { exact: true }).click()
    await settings.locator('[data-field="sync-server"]').fill(server)
    await settings.locator('[data-field="sync-name"]').fill(name)
  }
  const passphraseField = () =>
    settings
      .locator('[data-field="sync-passphrase"] input, input[data-field="sync-passphrase"]')
      .first()

  const writer = {
    name,
    page,
    errors,
    shot,
    openSettings,
    closeSettings,
    /** The recovery code sign-up showed. @type {string|null} */
    recoveryCode: null,

    /** Make the account, and keep the recovery code it shows. */
    async signUp() {
      await account('Create account')
      await passphraseField().fill(PASSPHRASE)
      await settings.locator('[data-field="sync-code"]').fill(SIGNUP_CODE)
      await settings.locator('[data-action="sync-sign-in"]').click()
      const shown = settings.locator('[data-recovery-code]')
      await shown.waitFor()
      writer.recoveryCode = ((await shown.textContent()) || '').trim()
      await settings.locator('[data-action="recovery-done"]').click()
      await settings.locator('[data-friend-code]').waitFor()
    },

    /** Sign in to the account, as another device of it does. @param {string} [passphrase] */
    async signIn(passphrase = PASSPHRASE) {
      await account('Sign in')
      await passphraseField().fill(passphrase)
      await settings.locator('[data-action="sync-sign-in"]').click()
      await settings.locator('[data-friend-code]').waitFor()
    },

    /** Sign out of the account on this device. */
    async signOut() {
      await openSettings('sync', 'account')
      await settings.locator('[data-action="sync-sign-out"]').click()
      await settings.locator('[data-field="sync-name"]').waitFor()
    },

    /** Try to sign in, and say what the form answered. @param {string} passphrase */
    async signInRefused(passphrase) {
      await account('Sign in')
      await passphraseField().fill(passphrase)
      await settings.locator('[data-action="sync-sign-in"]').click()
      return ((await settings.locator('[data-sync-error]').textContent()) || '').trim()
    },

    /**
     * Recover the account with its code, under a new passphrase; the new
     * code it shows is kept.
     * @param {string} code @param {string} passphrase
     */
    async recover(code, passphrase) {
      await account('Recover')
      await settings.locator('[data-field="sync-recovery-code"]').fill(code)
      await passphraseField().fill(passphrase)
      await settings.locator('[data-action="sync-sign-in"]').click()
      const shown = settings.locator('[data-recovery-code]')
      await shown.waitFor()
      writer.recoveryCode = ((await shown.textContent()) || '').trim()
      await settings.locator('[data-action="recovery-done"]').click()
    },

    /** Change the passphrase from the account's settings. @param {string} current @param {string} next */
    async changePassphrase(current, next) {
      await openSettings('sync', 'account')
      await settings.locator('[data-action="change-passphrase"]').click()
      await settings
        .locator('[data-field="sync-current"]')
        .locator('input')
        .or(settings.locator('input[data-field="sync-current"]'))
        .first()
        .fill(current)
      await settings
        .locator('[data-field="sync-next"]')
        .locator('input')
        .or(settings.locator('input[data-field="sync-next"]'))
        .first()
        .fill(next)
      await settings.locator('[data-action="sync-confirm"]').click()
      await settings.locator('[data-sync-asking]').waitFor({ state: 'hidden' })
    },

    /** The devices signed in to the account, as Settings lists them. */
    async devices() {
      await openSettings('sync', 'devices')
      await settings.locator('[data-device="this"]').waitFor()
      return settings.locator('[data-device]').count()
    },

    /** Sign the account's other device out from here. */
    async signOutOtherDevice() {
      await openSettings('sync', 'devices')
      await settings.locator('[data-action="sign-out-device"]').first().click()
      await page.waitForFunction(() => document.querySelectorAll('[data-device]').length === 1)
    },

    /** Whether this device is signed in, as the account's settings show it. */
    async signedIn() {
      await openSettings('sync', 'account')
      return settings.locator('[data-friend-code]').isVisible()
    },

    /** Make a project and open it. @param {string} title */
    async newProject(title) {
      await closeSettings()
      await button('Projects').click()
      await page.getByRole('menuitem', { name: 'New project…' }).click()
      const made = dialog('New project')
      await made.getByRole('textbox').first().fill(title)
      await made.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByRole('treeitem', { name: title }).first().waitFor()
    },

    /** Make a document in the open project and write in it. @param {string} title @param {string} text */
    async newDocument(title, text) {
      await closeSettings()
      await button('New document').first().click()
      await page.keyboard.type(title)
      await page.keyboard.press('Enter')
      await page.locator('.ProseMirror').click()
      await page.keyboard.type(text)
    },

    /** Open a document of the open project. @param {string} title */
    async openDocument(title) {
      await closeSettings()
      await page.getByRole('treeitem', { name: title }).first().click()
    },

    /** Write at the end of the open document. @param {string} text */
    async write(text) {
      await page.locator('.ProseMirror').click()
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type(text)
    },

    /** Wait until the open document says this. @param {string} text */
    async reads(text) {
      await page.locator('.ProseMirror').getByText(text).first().waitFor()
    },

    /** The Projects table: its dialog, opened. */
    async projects() {
      await closeSettings()
      const table = page.locator('[data-projects-dialog]')
      // The menu is drawn again when a project arrives, which takes the item
      // out from under a click: asked again until the table shows.
      for (let tries = 0; !(await table.isVisible()); tries++) {
        if (tries >= 10) throw new Error("The Projects table didn't open.")
        const item = page.getByRole('menuitem', { name: 'Projects…' })
        if (!(await item.isVisible())) await button('Projects').click()
        await item.click({ timeout: 2000 }).catch(() => {})
        await table.waitFor({ timeout: 2000 }).catch(() => {})
      }
      return table
    },
    async closeProjects() {
      const table = page.locator('[data-projects-dialog]')
      if (await table.isVisible()) await page.keyboard.press('Escape')
      await table.waitFor({ state: 'hidden' })
    },

    /** Wait until the Projects table has, or hasn't, a project of this name. @param {string} title @param {boolean} [there] */
    async hasProject(title, there = true) {
      const table = await writer.projects()
      const row = table.locator('[data-project]').filter({ hasText: title })
      await row.first().waitFor({ state: there ? 'visible' : 'hidden' })
      await writer.closeProjects()
    },

    /**
     * Open a project from the Projects table. A device just signed in opens
     * the project its account was last in by itself, so it may be open
     * before the table is asked, or as it is.
     * @param {string} title
     */
    async openProject(title) {
      await closeSettings()
      const open = page.getByRole('treeitem', { name: title }).first()
      for (let tries = 0; !(await open.isVisible()); tries++) {
        if (tries >= 10) throw new Error(`${title} didn't open.`)
        const table = await writer.projects()
        await table
          .locator('[data-project]')
          .filter({ hasText: title })
          .first()
          .click({ timeout: 2000 })
          .catch(() => {})
        await open.waitFor({ timeout: 2000 }).catch(() => {})
      }
      await writer.closeProjects()
    },

    /** The open project's sharing, in Settings: from the outline's Share… or People…. @param {string} title */
    async sharing(title) {
      await closeSettings()
      await page
        .getByRole('treeitem', { name: title })
        .first()
        .getByText(title)
        .first()
        .click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^(Share…|People…)$/ }).click()
      const share = settings.locator('[data-share]')
      await share.waitFor()
      return share
    },

    /** Share the open project with someone, by friend code or by name. @param {string} title @param {string} whom */
    async share(title, whom) {
      const share = await writer.sharing(title)
      await share.locator('[data-field="share-code"]').fill(whom)
      await share.locator('[data-action="share"]').click()
      const settled = await Promise.race([
        share
          .locator('[data-member-invited]')
          .first()
          .waitFor()
          .then(() => 'shared'),
        share
          .locator('[data-share-error]')
          .waitFor()
          .then(() => 'refused'),
      ])
      if (settled === 'refused') {
        throw new Error(((await share.locator('[data-share-error]').textContent()) || '').trim())
      }
      return share
    },

    /** Whether Share can be clicked with this typed. @param {string} title @param {string} whom */
    async canShare(title, whom) {
      const share = await writer.sharing(title)
      await share.locator('[data-field="share-code"]').fill(whom)
      return share.locator('[data-action="share"]').isEnabled()
    },

    /** The names in the open project's People, with what each is marked. @param {string} title */
    async members(title) {
      const share = await writer.sharing(title)
      return share
        .locator('[data-member]')
        .evaluateAll(rows => rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    },

    /** The invitation toast naming this project. @param {string} title */
    invitation(title) {
      return page.locator('.p-toast-message').filter({ hasText: title })
    },

    /** Answer an invitation from its toast. @param {string} title @param {'accept'|'reject'|'block'} answer */
    async answer(title, answer) {
      const toast = writer.invitation(title)
      await toast.waitFor()
      await toast.locator(`[data-action="invitation-${answer}"]`).click()
    },

    /** Whether an invitation to this project shows within a few seconds. @param {string} title */
    async invited(title) {
      return writer
        .invitation(title)
        .waitFor({ timeout: 6000 })
        .then(
          () => true,
          () => false
        )
    },

    /** Answer an invitation from its row in the Projects table. @param {string} title @param {'accept'|'reject'} answer */
    async answerInProjects(title, answer) {
      const table = await writer.projects()
      const row = table.locator('[data-invitation]').filter({ hasText: title })
      await row.locator(`[data-action="${answer}-invitation"]`).click()
      await row.waitFor({ state: 'hidden' })
      await writer.closeProjects()
    },

    /** Say yes to what blocking someone will end, where it asks. */
    async confirmBlock() {
      await page.locator('[data-action="block-confirm"]').click()
      await page.locator('[data-block-dialog]').waitFor({ state: 'hidden' })
    },

    /** What blocking says it will end, where it asks. */
    async blockAsks() {
      const asking = page.locator('[data-block-dialog]')
      await asking.waitFor()
      return ((await asking.textContent()) || '').replace(/\s+/g, ' ').trim()
    },

    /** The people the account keeps, as Settings lists them: each name, and "Blocked" after a blocked one. */
    async people({ blocked = false } = {}) {
      await openSettings('sync', 'people')
      const toggle = settings.locator('[data-action="show-blocked"]')
      if (blocked) {
        // The button is there once someone is blocked, which the server says a moment after.
        await toggle.waitFor({ timeout: 5000 }).catch(() => {})
        if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-pressed')) !== 'true') {
          await toggle.click()
        }
      }
      return settings
        .locator('[data-person]')
        .evaluateAll(rows => rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    },

    /** Add someone to the account's people by their friend code. @param {string} code */
    async addPerson(code) {
      await openSettings('sync', 'people')
      await settings.locator('[data-action="add-person"]').click()
      await settings.locator('[data-field="add-person"]').fill(code)
      await page.keyboard.press('Enter')
    },

    /** Pick from someone's menu in the account's people. @param {string} name @param {string} item */
    async personMenu(name, item) {
      await writer.people({ blocked: true })
      await settings.locator('[data-person]').filter({ hasText: name }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: item, exact: true }).click()
    },

    /** Take someone out of the open project. @param {string} title @param {string} name */
    async removeMember(title, name) {
      const share = await writer.sharing(title)
      const member = share.locator('[data-member]').filter({ hasText: name })
      await member.locator('[data-action="remove-member"]').click()
      await member.waitFor({ state: 'hidden' })
    },

    /** Remove the open project from the outline's menu. @param {string} title */
    async removeProject(title) {
      await closeSettings()
      await page
        .getByRole('treeitem', { name: title })
        .first()
        .getByText(title)
        .first()
        .click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
      await page.getByRole('treeitem', { name: title }).first().waitFor({ state: 'hidden' })
    },

    /** Bring a removed project back from the trash. @param {string} title */
    async restoreProject(title) {
      await closeSettings()
      await button('Projects').click()
      await page.getByRole('menuitem', { name: 'Trash', exact: true }).click()
      const trash = page.locator('[data-trash-dialog]')
      await trash
        .locator('[data-trash-project]')
        .filter({ hasText: title })
        .locator('[data-action="restore"]')
        .click()
      await page.keyboard.press('Escape')
    },

    /** What the account's settings say went wrong, if anything. */
    async notice() {
      await openSettings('sync', 'account')
      const notice = settings.locator('[data-sync-notice]')
      await notice.waitFor()
      return ((await notice.textContent()) || '').trim()
    },

    /** @returns {Promise<string>} */
    async friendCode() {
      await openSettings('sync', 'account')
      return ((await settings.locator('[data-friend-code]').textContent()) || '').trim()
    },
  }
  return writer
}

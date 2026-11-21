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
  /** The open project's outline, and a row of it by its title. */
  const outline = page.getByRole('tree', { name: 'Documents' })
  const row = (/** @type {string} */ title) =>
    outline.getByRole('treeitem', { name: title, exact: true }).first()

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

  /**
   * Wait until the page shows what it should, read again until it does; what
   * it showed instead is the failure.
   * @param {() => Promise<string[]>} read
   * @param {string[]} wanted - In any order
   * @param {string} what - What is read, for the failure to say
   */
  const settles = async (read, wanted, what) => {
    const same = (/** @type {string[]} */ lines) => [...lines].sort().join('\n')
    const until = Date.now() + SYNCED
    for (;;) {
      const seen = await read()
      if (same(seen) === same(wanted)) return
      if (Date.now() > until) {
        throw new Error(
          `Expected ${what} to be ${[...wanted].sort().join(', ') || 'nothing'}. ${label} has ${[...seen].sort().join(', ') || 'nothing'}.`
        )
      }
      await page.waitForTimeout(500)
    }
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

    /**
     * Make a document in the open project, at its top or in a folder of it,
     * and write in it.
     * @param {string} title @param {string} text @param {string} [within] - The folder's title
     */
    async newDocument(title, text, within) {
      await closeSettings()
      if (within) await writer.menu(within, 'New document')
      else await button('New document').first().click()
      await page.keyboard.type(title)
      await page.keyboard.press('Enter')
      await row(title).waitFor()
      await page.locator('.ProseMirror').click()
      await page.keyboard.type(text)
    },

    /** Make a folder in the open project: in a folder of it, or in the project itself. @param {string} title @param {string} within */
    async newFolder(title, within) {
      await writer.menu(within, 'New folder')
      await page.keyboard.type(title)
      await page.keyboard.press('Enter')
      await row(title).waitFor()
    },

    /** Open the menu of a row of the open project's outline. @param {string} title */
    async openMenu(title) {
      await closeSettings()
      await row(title).getByText(title, { exact: true }).first().click({ button: 'right' })
      await page.getByRole('menuitem').first().waitFor()
      // The keys are the menu's a moment after it shows, Escape among them.
      await page.waitForFunction(() => document.activeElement?.closest('.p-contextmenu'))
    },

    /** Pick from the menu of a row of the open project's outline. @param {string} title @param {string} item */
    async menu(title, item) {
      await writer.openMenu(title)
      await page.getByRole('menuitem', { name: item, exact: true }).click()
    },

    /** What the menu of a row of the open project's outline offers. @param {string} title */
    async menuItems(title) {
      await writer.openMenu(title)
      const items = await page.getByRole('menuitem').allTextContents()
      await page.keyboard.press('Escape')
      await page.getByRole('menuitem').first().waitFor({ state: 'hidden' })
      return items.map(item => item.replace(/\s+/g, ' ').trim())
    },

    /**
     * The open project's outline with every folder open: each document by
     * its path from the project, with what its row marks it as to the people
     * the project is shared with ('shared', or 'partly' for a folder they
     * see only on the way to something), if anything.
     * @returns {Promise<Record<string, string|null>>}
     */
    async outline() {
      await closeSettings()
      const shut = outline.locator('[role="treeitem"][aria-expanded="false"]')
      for (let opened = 0; opened < 50 && (await shut.count()) > 0; opened++) {
        await shut.first().locator('button[aria-label="Expand"]').click()
      }
      return outline.locator('[role="treeitem"]').evaluateAll(rows => {
        /** @type {string[]} */
        const path = []
        /** @type {Record<string, string|null>} */
        const seen = {}
        for (const one of rows) {
          // The first level is the project itself.
          const level = Number(one.getAttribute('aria-level'))
          if (level < 2) continue
          path.length = level - 2
          path.push(one.getAttribute('aria-label') ?? '')
          seen[path.join('/')] =
            one.querySelector('[data-share-mark]')?.getAttribute('data-share-mark') ?? null
        }
        return seen
      })
    },

    /** Wait until the open project's outline has these documents and no others, each by its path. @param {string[]} paths */
    async sees(paths) {
      await settles(async () => Object.keys(await writer.outline()), paths, 'the outline')
    },

    /**
     * Wait until the open project's outline marks these documents as shared
     * and no others: each by its path, 'partly' for a folder the others see
     * only on the way to something.
     * @param {Record<string, 'shared'|'partly'>} marks
     */
    async marks(marks) {
      const lines = (/** @type {Record<string, string|null>} */ rows) =>
        Object.entries(rows)
          .filter(([, mark]) => mark)
          .map(([path, mark]) => `${path} (${mark})`)
      await settles(async () => lines(await writer.outline()), lines(marks), "the outline's marks")
    },

    /**
     * Whether anything this device keeps says this, in the outline or out of
     * it: a row of any table of the app's database, as it is stored.
     * @param {string} text
     */
    async keeps(text) {
      return page.evaluate(async said => {
        /** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
        const done = request =>
          new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
        const db = await done(window.indexedDB.open('inksprite'))
        try {
          for (const table of db.objectStoreNames) {
            const rows = await done(db.transaction(table).objectStore(table).getAll())
            if (rows.some(row => JSON.stringify(row)?.includes(said))) return true
          }
          return false
        } finally {
          db.close()
        }
      }, text)
    },

    /** Wait until this device keeps nothing that says this: what sync takes away goes from the database a moment after the page. @param {string} text */
    async forgets(text) {
      for (let waited = 0; await writer.keeps(text); waited += 500) {
        if (waited >= SYNCED) throw new Error(`Expected ${label} to keep nothing saying ${text}.`)
        await page.waitForTimeout(500)
      }
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

    /** The open project's sharing, in Settings: from the outline's Share… or People…, or as it is showing. @param {string} title */
    async sharing(title) {
      const showing = settings.locator('[data-share]')
      if (await showing.isVisible()) return showing
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

    /**
     * Share the open project whole, or only the documents ticked, from the
     * switch over its boxes.
     * @param {string} title @param {boolean} whole
     */
    async shareWhole(title, whole) {
      const share = await writer.sharing(title)
      const field = share.locator('[data-field="share-whole"] input')
      if ((await field.isChecked()) === whole) return
      await field.click()
      // The switch is the choice at once, and can be clicked again when sync has it.
      await share.locator('[data-field="share-whole"] input:not([disabled])').waitFor()
      if (await share.locator('[data-share-error]').isVisible()) {
        throw new Error(((await share.locator('[data-share-error]').textContent()) || '').trim())
      }
      if ((await field.isChecked()) !== whole) {
        throw new Error(`The project is ${whole ? 'not ' : ''}shared whole still.`)
      }
    },

    /**
     * The boxes of the open project's sharing, every folder open: each
     * document by its path from the project, the project itself as '', and
     * its box as ticked, half ticked or empty.
     * @param {string} title
     * @returns {Promise<Record<string, 'ticked'|'half'|'empty'>>}
     */
    async boxes(title) {
      const share = await writer.sharing(title)
      const tree = share.locator('[data-share-tree]')
      const shut = tree.locator(
        'li[role="treeitem"][aria-expanded="false"]:has(> div > button[data-p-leaf="false"])'
      )
      for (let opened = 0; opened < 50 && (await shut.count()) > 0; opened++) {
        await shut.first().locator(':scope > div > button').click()
      }
      return tree.locator('li[role="treeitem"]').evaluateAll(nodes => {
        /** @type {string[]} */
        const path = []
        /** @type {Record<string, 'ticked'|'half'|'empty'>} */
        const seen = {}
        for (const node of nodes) {
          const level = Number(node.getAttribute('aria-level'))
          path.length = Math.max(level - 2, 0)
          if (level > 1) path.push(node.getAttribute('aria-label') ?? '')
          const box = /** @type {HTMLInputElement|null} */ (
            node.querySelector(':scope > div input[type="checkbox"]')
          )
          seen[path.join('/')] = box?.checked
            ? 'ticked'
            : box?.closest('[data-p-indeterminate]')
              ? 'half'
              : 'empty'
        }
        return seen
      })
    },

    /**
     * Tick a document's box in the open project's sharing, or untick it,
     * opening the folders it is in.
     * @param {string} title @param {string} path - From the project @param {boolean} shared
     */
    async tick(title, path, shared) {
      const share = await writer.sharing(title)
      let node = share.locator('[data-share-tree] li[role="treeitem"]').first()
      for (const name of path.split('/')) {
        if ((await node.getAttribute('aria-expanded')) !== 'true') {
          await node.locator(':scope > div > button').click()
        }
        node = node.locator(`:scope > ul > li[role="treeitem"][aria-label="${name}"]`)
      }
      const box = node.locator(':scope > div input[type="checkbox"]')
      if ((await box.isChecked()) !== shared) await box.click()
      for (let waited = 0; (await box.isChecked()) !== shared; waited += 100) {
        if (waited >= 5000) throw new Error(`The box of ${path} didn't change.`)
        await page.waitForTimeout(100)
      }
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

    /** The documents of the open project in the trash, by title: none while the trash holds nothing. */
    async trash() {
      await closeSettings()
      await button('Projects').click()
      const item = page.getByRole('menuitem', { name: 'Open trash…', exact: true })
      await page.getByRole('menuitem', { name: 'New project…' }).waitFor()
      if (!(await item.isVisible())) {
        await page.keyboard.press('Escape')
        return []
      }
      await item.click()
      const trash = page.locator('[data-trash-dialog]')
      await trash.waitFor()
      const titles = await trash
        .locator('[data-trash-item] span.truncate:first-child')
        .allTextContents()
      await page.keyboard.press('Escape')
      await trash.waitFor({ state: 'hidden' })
      return titles.map(title => title.trim())
    },

    /** Take this device off the network, or put it back on. @param {boolean} off */
    async offline(off) {
      await context.setOffline(off)
    },

    /** Bring a removed project back from the trash. @param {string} title */
    async restoreProject(title) {
      await closeSettings()
      await button('Projects').click()
      await page.getByRole('menuitem', { name: 'Open trash…', exact: true }).click()
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

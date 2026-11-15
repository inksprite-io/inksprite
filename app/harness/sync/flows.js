/**
 * The flows: each a few writers doing one thing sync or sharing is for, and
 * what each of them then sees. Every flow has people of its own, so none
 * depends on another.
 */

/**
 * @typedef {Awaited<ReturnType<typeof import('./writer.js').makeWriter>>} Writer
 * @typedef {{writer: (name: string) => Promise<Writer>, device: (writer: Writer) => Promise<Writer>}} Cast
 */

/**
 * @param {unknown} held
 * @param {string} what - What should have held, for the failure to say
 */
function check(held, what) {
  if (!held) throw new Error(`Expected ${what}.`)
}

/**
 * Writers with accounts.
 * @param {Cast} cast
 * @param {...string} names
 */
async function signedUp(cast, ...names) {
  const writers = []
  for (const name of names) {
    const writer = await cast.writer(name)
    await writer.signUp()
    writers.push(writer)
  }
  return writers
}

/**
 * A project of one writer's with a document in it, shared with another and accepted.
 * @param {Writer} owner
 * @param {Writer} friend
 * @param {string} title
 */
async function shared(owner, friend, title) {
  await owner.newProject(title)
  await owner.newDocument('Plan', `The plan for ${title}.`)
  await owner.share(title, await friend.friendCode())
  await friend.closeSettings()
  await friend.answer(title, 'accept')
  await friend.hasProject(title)
}

/** @type {Array<{name: string, run: (cast: Cast) => Promise<void>}>} */
export const FLOWS = [
  {
    name: 'account: signed out and in again, a wrong passphrase refused',
    run: async cast => {
      const [ada] = await signedUp(cast, 'ada')
      await ada.newProject('Heist')
      await ada.signOut()
      const refused = await ada.signInRefused('not the passphrase')
      check(refused, 'a wrong passphrase to be refused with a reason')
      await ada.signIn()
      await ada.hasProject('Heist')
    },
  },
  {
    name: 'devices: a second device gets the projects, and is signed out from the first',
    run: async cast => {
      const [ada] = await signedUp(cast, 'ada')
      await ada.newProject('Heist')
      await ada.newDocument('Plan', 'Go in by the roof.')

      const phone = await cast.device(ada)
      await phone.openProject('Heist')
      await phone.openDocument('Plan')
      await phone.reads('Go in by the roof.')

      check((await ada.devices()) === 2, 'two devices listed')
      await ada.signOutOtherDevice()
      check(/signed out/i.test(await phone.notice()), 'the other device to say it was signed out')
    },
  },
  {
    name: 'recovery: the code signs in under a new passphrase, and the passphrase changes',
    run: async cast => {
      const [ada] = await signedUp(cast, 'ada')
      const code = ada.recoveryCode
      check(code, 'a recovery code at sign-up')
      await ada.newProject('Heist')
      await ada.signOut()

      await ada.recover(/** @type {string} */ (code), 'a second passphrase')
      check(ada.recoveryCode && ada.recoveryCode !== code, 'a new recovery code')
      await ada.hasProject('Heist')

      await ada.changePassphrase('a second passphrase', 'a third passphrase')
      await ada.signOut()
      check(await ada.signInRefused('a second passphrase'), 'the old passphrase to be refused')
      await ada.signIn('a third passphrase')
    },
  },
  {
    name: 'share: accepted from the toast, edits go both ways, and both sides list who is in it',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await ada.newProject('Heist')
      await ada.newDocument('Plan', 'Go in by the roof.')
      await ada.share('Heist', await ben.friendCode())
      check(
        (await ada.members('Heist')).some(row => row.includes(ben.name) && row.includes('Invited')),
        'the friend listed as invited'
      )

      await ben.closeSettings()
      await ben.answer('Heist', 'accept')
      await ben.openProject('Heist')
      await ben.openDocument('Plan')
      await ben.reads('Go in by the roof.')
      await ben.write(' Leave by the river.')

      await ada.openDocument('Plan')
      await ada.reads('Leave by the river.')

      const theirs = await ben.members('Heist')
      check(
        theirs.some(row => row.includes(ada.name) && row.includes('Owner')),
        'the owner named to the friend'
      )
      check(
        theirs.some(row => row.includes(ben.name) && row.includes('You')),
        'the friend marked as You'
      )
      const mine = await ada.members('Heist')
      check(
        mine.some(row => row.includes(ben.name) && !row.includes('Invited')),
        'the friend no longer invited'
      )
    },
  },
  {
    name: 'share: accepted from the Projects table',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await ada.newProject('Heist')
      await ada.share('Heist', await ben.friendCode())
      await ben.answerInProjects('Heist', 'accept')
      await ben.hasProject('Heist')
    },
  },
  {
    name: 'share: rejected, gone from both sides, and shared again',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      const code = await ben.friendCode()
      await ada.newProject('Heist')
      await ada.share('Heist', code)
      await ben.closeSettings()
      await ben.answer('Heist', 'reject')
      await ben.invitation('Heist').waitFor({ state: 'hidden' })
      await ben.hasProject('Heist', false)

      await ada.page.waitForTimeout(3000)
      check(
        !(await ada.members('Heist')).some(row => row.includes(ben.name)),
        'the friend who rejected it gone from its people'
      )
      await ada.share('Heist', code)
      check(await ben.invited('Heist'), 'a second invitation')
    },
  },
  {
    name: 'share: what is no friend code can’t be sent, and a code nobody has is refused',
    run: async cast => {
      const [ada] = await signedUp(cast, 'ada')
      await ada.newProject('Heist')
      check(!(await ada.canShare('Heist', 'not a code')), 'Share to wait for a name or a code')
      const nobody = await ada.share('Heist', 'ABCDE-FGHJK-MNPQR-STVWX').then(
        () => '',
        error => String(error.message)
      )
      check(nobody, 'a refusal of a code nobody has')
    },
  },
  {
    name: 'three: a project shared with two friends carries one friend’s edit to the other',
    run: async cast => {
      const [ada, ben, cy] = await signedUp(cast, 'ada', 'ben', 'cy')
      await shared(ada, ben, 'Heist')
      await ada.share('Heist', await cy.friendCode())
      await cy.closeSettings()
      await cy.answer('Heist', 'accept')

      await cy.openProject('Heist')
      await cy.openDocument('Plan')
      await cy.write(' Cy brings the rope.')
      await ben.openProject('Heist')
      await ben.openDocument('Plan')
      await ben.reads('Cy brings the rope.')
      check(
        (await ben.members('Heist')).some(row => row.includes(cy.name)),
        'one friend named to the other'
      )
    },
  },
  {
    name: 'people: added by friend code, then shared with by name',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await ada.addPerson(await ben.friendCode())
      await ada.page.waitForTimeout(1500)
      check(
        (await ada.people()).some(row => row.includes(ben.name)),
        'the friend among the people'
      )

      await ada.newProject('Heist')
      await ada.share('Heist', ben.name)
      check(await ben.invited('Heist'), 'an invitation from a share by name')
    },
  },
  {
    name: 'remove: the owner takes a friend out, and the project leaves the friend',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await shared(ada, ben, 'Heist')
      await ada.removeMember('Heist', ben.name)
      await ben.hasProject('Heist', false)
      await ada.hasProject('Heist')
    },
  },
  {
    name: 'remove: a friend removes a shared project, the owner keeps it, and the friend restores it',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await shared(ada, ben, 'Heist')
      await ben.openProject('Heist')
      await ben.removeProject('Heist')
      await ben.hasProject('Heist', false)
      await ada.hasProject('Heist')

      await ben.restoreProject('Heist')
      await ben.hasProject('Heist')
    },
  },
  {
    name: 'block: from an invitation, which goes; nothing more arrives until unblocked',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      const code = await ben.friendCode()
      await ada.newProject('Heist')
      await ada.share('Heist', code)
      await ben.closeSettings()
      await ben.answer('Heist', 'block')
      await ben.invitation('Heist').waitFor({ state: 'hidden' })
      check(
        (await ben.people({ blocked: true })).some(
          row => row.includes(ada.name) && row.includes('Blocked')
        ),
        'the one blocked listed as blocked'
      )

      await ada.newProject('Alibi')
      await ada.share('Alibi', code).catch(() => {})
      await ben.closeSettings()
      check(!(await ben.invited('Alibi')), 'no invitation from someone blocked')

      await ben.personMenu(ada.name, 'Unblock')
      await ada.newProject('Getaway')
      await ada.share('Getaway', code)
      await ben.closeSettings()
      check(await ben.invited('Getaway'), 'an invitation once unblocked')
    },
  },
  {
    name: 'block: with projects shared both ways, it says what ends, and both end',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await shared(ada, ben, 'Heist')
      await shared(ben, ada, 'Alibi')

      await ada.personMenu(ben.name, 'Block')
      const asks = await ada.blockAsks()
      check(/taken out of Heist/.test(asks), 'the block to say they leave Heist')
      check(/leave Alibi/.test(asks), 'the block to say you leave Alibi')
      await ada.confirmBlock()

      await ben.hasProject('Heist', false)
      await ada.hasProject('Heist')
      await ben.openProject('Alibi')
      await ben.page.waitForTimeout(3000)
      check(
        !(await ben.members('Alibi')).some(row => row.includes(ada.name)),
        'the one who blocked gone from the other’s project'
      )
    },
  },
]

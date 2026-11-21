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

/**
 * What a friend sees of a project shared by `sharedPartly`: the plan, the
 * chapters, and the one note shown, with the folder it is in.
 */
const SHOWN = ['Plan', 'Chapters', 'Chapters/One', 'Chapters/Two', 'Notes', 'Notes/Map']

/** What `sharedPartly` holds back. */
const HELD_BACK = ['Diary', 'Notes/Secret']

/**
 * A project of one writer's shared with another, who accepts and opens it,
 * with only some of its documents: a diary at its top held back, and a
 * folder of notes held back but for one of them.
 * @param {Writer} owner
 * @param {Writer} friend
 * @param {string} title
 */
async function sharedPartly(owner, friend, title) {
  await owner.newProject(title)
  await owner.newDocument('Plan', 'Go in by the roof.')
  await owner.newDocument('Diary', 'Nobody reads this.')
  await owner.newFolder('Chapters', title)
  await owner.newDocument('One', 'It was raining.', 'Chapters')
  await owner.newDocument('Two', 'It stopped.', 'Chapters')
  await owner.newFolder('Notes', title)
  await owner.newDocument('Map', 'The vault is under the stairs.', 'Notes')
  await owner.newDocument('Secret', 'The guard is in on it.', 'Notes')

  await owner.shareWhole(title, false)
  await owner.tick(title, 'Diary', false)
  await owner.tick(title, 'Notes', false)
  await owner.tick(title, 'Notes/Map', true)
  await owner.share(title, await friend.friendCode())
  await friend.closeSettings()
  await friend.answer(title, 'accept')
  await friend.openProject(title)
  await friend.sees(SHOWN)
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
  {
    name: 'some documents: the friend gets those ticked and the folders on the way, and only the owner’s outline marks them',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')
      await ben.openDocument('Map')
      await ben.reads('The vault is under the stairs.')

      const boxes = await ada.boxes('Heist')
      check(
        ['', 'Plan', 'Chapters', 'Chapters/One', 'Chapters/Two', 'Notes/Map'].every(
          path => boxes[path] === 'ticked'
        ),
        `a ticked box for what is shared, of ${JSON.stringify(boxes)}`
      )
      check(
        boxes.Notes === 'half',
        `a half-ticked box for the folder on the way, not ${boxes.Notes}`
      )
      check(
        HELD_BACK.every(path => boxes[path] === 'empty'),
        `an empty box for what is held back, of ${JSON.stringify(boxes)}`
      )
      await ada.marks({
        Plan: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        'Chapters/Two': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })

      // What the owner writes next arrives, and still nothing held back with it.
      await ada.openDocument('Plan')
      await ada.write(' Leave by the river.')
      await ben.openDocument('Plan')
      await ben.reads('Leave by the river.')
      await ben.sees(SHOWN)
      check(
        await ada.keeps('The guard is in on it.'),
        'the owner’s device to keep what is held back'
      )
      for (const said of ['Nobody reads this.', 'The guard is in on it.', '"Diary"', '"Secret"']) {
        check(!(await ben.keeps(said)), `nothing on the friend’s device saying ${said}`)
      }
      await ben.marks({})
      check(
        !(await ben.menuItems('Map')).some(item => /shar/i.test(item)),
        'nothing about sharing on a document’s menu for the friend'
      )
      const theirs = await ben.sharing('Heist')
      check(
        (await theirs.locator('[data-field="share-whole"], [data-share-tree]').count()) === 0,
        'no choice of what is shared for the friend'
      )
    },
  },
  {
    name: 'some documents: one held back leaves the friend, and shown again comes back',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')

      // From the outline: a chapter, whose folder stays shared.
      await ada.menu('Two', 'Stop sharing')
      await ben.sees(SHOWN.filter(path => path !== 'Chapters/Two'))
      await ben.forgets('It stopped.')
      await ada.marks({
        Plan: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })
      await ada.menu('Two', 'Share')
      await ben.sees(SHOWN)
      await ben.openDocument('Two')
      await ben.reads('It stopped.')

      // From its box: the one note shown, and the folder that was only on the way to it.
      // Escape closes the settings from a box as from anywhere in them.
      await ada.tick('Heist', 'Notes/Map', false)
      await ada.closeSettings()
      await ben.sees(SHOWN.filter(path => !path.startsWith('Notes')))
      await ada.tick('Heist', 'Notes/Map', true)
      await ben.sees(SHOWN)
      await ben.openDocument('Map')
      await ben.reads('The vault is under the stairs.')
    },
  },
  {
    name: 'some documents: one held back while the friend’s edit to it waits goes to the friend’s trash, and the edit nowhere',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')

      await ben.openDocument('Two')
      await ben.reads('It stopped.')
      await ben.offline(true)
      await ben.write(' Ben was not there.')
      await ada.menu('Two', 'Stop sharing')
      // Long enough for the owner's change to be on the server before the friend is back.
      await ada.page.waitForTimeout(6000)
      await ben.offline(false)

      await ben.sees(SHOWN.filter(path => path !== 'Chapters/Two'))
      check(
        (await ben.trash()).includes('Two'),
        'the friend’s copy in their trash, with their edit'
      )
      await ben.page.waitForTimeout(6000)
      await ada.openDocument('Two')
      await ada.reads('It stopped.')
      check(!(await ada.keeps('Ben was not there.')), 'the friend’s edit to stay with the friend')
      await ada.sees([...SHOWN, ...HELD_BACK])
      await ada.marks({
        Plan: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })
    },
  },
  {
    name: 'some documents: a new document is shared in a shared folder, and held back in one that isn’t',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')

      // The one held back is made first, so that it has gone, if it goes, by
      // the time the others arrive. The project's own box is ticked, so one
      // made at its top is shared.
      await ada.newDocument('Doubts', 'What if the guard talks?', 'Notes')
      await ada.newDocument('Three', 'The sun came out.', 'Chapters')
      await ada.newDocument('Ending', 'They got away.')
      const now = [...SHOWN, 'Chapters/Three', 'Ending']
      await ben.sees(now)
      await ben.openDocument('Three')
      await ben.reads('The sun came out.')
      await ben.openDocument('Ending')
      await ben.reads('They got away.')
      await ada.marks({
        Plan: 'shared',
        Ending: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        'Chapters/Two': 'shared',
        'Chapters/Three': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })

      await ben.page.waitForTimeout(5000)
      await ben.sees(now)
      check(!(await ben.keeps('What if the guard talks?')), 'nothing of it on the friend’s device')
    },
  },
  {
    name: 'some documents: the friend’s edit to a shared document reaches the owner, and their new document too',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')

      await ben.openDocument('One')
      await ben.reads('It was raining.')
      await ben.write(' Ben brings an umbrella.')
      await ada.openDocument('One')
      await ada.reads('Ben brings an umbrella.')

      await ben.newDocument('Getaway', 'A boat, not a car.', 'Chapters')
      await ada.sees([...SHOWN, ...HELD_BACK, 'Chapters/Getaway'])
      await ada.openDocument('Getaway')
      await ada.reads('A boat, not a car.')
      await ada.marks({
        Plan: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        'Chapters/Two': 'shared',
        'Chapters/Getaway': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })
      await ben.sees([...SHOWN, 'Chapters/Getaway'])
    },
  },
  {
    name: 'some documents: shared whole again, the friend gets the rest; and only some again, loses it',
    run: async cast => {
      const [ada, ben] = await signedUp(cast, 'ada', 'ben')
      await sharedPartly(ada, ben, 'Heist')

      await ada.shareWhole('Heist', true)
      await ben.sees([...SHOWN, ...HELD_BACK])
      await ben.openDocument('Secret')
      await ben.reads('The guard is in on it.')
      await ada.marks({})

      // The boxes are as they were left, and what they hold back goes from the friend again.
      await ada.shareWhole('Heist', false)
      await ben.sees(SHOWN)
      await ben.forgets('The guard is in on it.')
      await ben.forgets('Nobody reads this.')
      await ada.marks({
        Plan: 'shared',
        Chapters: 'shared',
        'Chapters/One': 'shared',
        'Chapters/Two': 'shared',
        Notes: 'partly',
        'Notes/Map': 'shared',
      })
    },
  },
]

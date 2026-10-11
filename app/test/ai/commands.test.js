import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseCommand,
  formatCommand,
  formatSegment,
  formatTurn,
  formatAnswered,
  splitAnswered,
  splitInput,
  runCommand,
  renderCommand,
  inspectCommand,
  assembleTurn,
  askedCommand,
  pendingCommand,
  commandRepeatable,
  commandDetail,
  commandTakesTurn,
  commandTag,
  listCommands,
  matchCommands,
  commandAtCaret,
  COMMANDS,
  LIKELIHOODS,
} from '@/ai/commands.js'
import { MAJOR_ARCANA, MINOR_ARCANA } from '@/ai/tools/data/tarot.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseCommand', () => {
  it('leaves an ordinary message alone', () => {
    // Everything the writer types passes through here, and almost none of it
    // is a command.
    expect(parseCommand('I push open the inn door.')).toBeNull()
    expect(parseCommand('')).toBeNull()
    expect(parseCommand(undefined)).toBeNull()
  })

  it('takes the rest of the line as the one thing it was given', () => {
    // No quoting. The sentence is the argument, and any quotes in it are the
    // writer's own.
    expect(parseCommand('/director This scene needs more tension.')).toEqual({
      name: 'director',
      input: 'This scene needs more tension.',
    })
    expect(parseCommand('/oracle Is the door "locked"?').input).toBe('Is the door "locked"?')
  })

  it('reads the setting out of the parentheses', () => {
    expect(parseCommand('/oracle(likely) Is the door locked?')).toEqual({
      name: 'oracle',
      param: 'likely',
      input: 'Is the door locked?',
    })
  })

  it('treats empty parentheses as none at all', () => {
    expect(parseCommand('/oracle() Is it?').param).toBeUndefined()
  })

  it('takes a command with nothing after it', () => {
    expect(parseCommand('/compact')).toEqual({ name: 'compact', input: '' })
  })

  it('takes a name with the punctuation names have', () => {
    expect(parseCommand("@o'brien He shrugs.")).toEqual({
      name: "o'brien",
      character: true,
      input: 'He shrugs.',
    })
    expect(parseCommand('@mrs-hale She sets down the tray.').name).toBe('mrs-hale')
  })

  it('reads the sigil, not the name', () => {
    // `/` is an instruction to the application and `@` is a person, which is
    // what both mean everywhere else. Nothing about the name decides it.
    expect(parseCommand('/oracle Is it?').character).toBeUndefined()
    expect(parseCommand('@oracle "I see all."').character).toBe(true)
  })

  it('keeps the name as it was typed, whoever it turns out to be', () => {
    // A command is canonicalised where it is looked up. A character's name is
    // theirs, and Mrs-Hale is not mrs-hale.
    expect(parseCommand('/Oracle Is it?').name).toBe('Oracle')
    expect(parseCommand('@Mrs-Hale She sets down the tray.').name).toBe('Mrs-Hale')
  })

  it('keeps a direction that runs to more than one line', () => {
    // Not something the composer can produce — it judges a line at a time —
    // but an edited command is one command, and may be a paragraph.
    expect(parseCommand('/director Wrap this up.\n\nThen cut to morning.').input).toBe(
      'Wrap this up.\n\nThen cut to morning.'
    )
  })
})

describe('formatCommand', () => {
  it('writes a command back the way it would be typed', () => {
    expect(formatCommand({ name: 'director', input: 'Wrap this scene up' })).toBe(
      '/director Wrap this scene up'
    )
    expect(formatCommand({ name: 'oracle', param: 'likely', input: 'Is it?' })).toBe(
      '/oracle(likely) Is it?'
    )
    expect(formatCommand({ name: 'compact', input: '' })).toBe('/compact')
  })

  it('round-trips whatever was parsed, so an edit starts where the writer left off', () => {
    for (const line of [
      '/roll 3d6+2',
      '/oracle(very_likely) Is the door locked?',
      '/interpret What is this innkeeper afraid of?',
    ]) {
      expect(formatCommand(parseCommand(line))).toBe(line)
    }
  })
})

describe('listCommands', () => {
  it('lists every command, in alphabetical order', () => {
    const names = listCommands().map(entry => entry.name)

    expect(names).toEqual(Object.keys(COMMANDS).sort())
  })

  it('gives every command a line saying what it does', () => {
    for (const entry of listCommands()) {
      expect(entry.description, entry.name).toMatch(/\S/)
      expect(entry.usage.startsWith(`/${entry.name}`), entry.name).toBe(true)
    }
  })

  it('marks the ones that call the model', () => {
    const consulting = listCommands()
      .filter(entry => entry.consults)
      .map(entry => entry.name)

    expect(consulting).toEqual(['compact', 'interpret', 'write'])
  })

  it('marks the ones that take a setting in parentheses', () => {
    const withParam = listCommands()
      .filter(entry => entry.takesParam)
      .map(entry => entry.name)

    expect(withParam).toEqual(['compact', 'name', 'oracle', 'tarot'])
  })
})

describe('matchCommands', () => {
  it('offers everything for a bare slash', () => {
    expect(matchCommands('')).toHaveLength(Object.keys(COMMANDS).length)
  })

  it('puts the names a query starts before the ones with a later word it starts', () => {
    // `roll` starts two names; `roll-table` is also found by `table`, which
    // starts none.
    expect(matchCommands('roll').map(entry => entry.name)).toEqual(['roll', 'roll-table'])
    expect(matchCommands('table').map(entry => entry.name)).toEqual(['roll-table'])
    expect(matchCommands('t').map(entry => entry.name)).toEqual(['tarot', 'roll-table'])
  })

  it('does not find a letter just anywhere in a name', () => {
    // `interpret` and `write` both have a t in them, and neither is what
    // somebody typing /t has started.
    expect(matchCommands('t').map(entry => entry.name)).not.toContain('write')
  })

  it('matches however it was capitalised, as the commands do', () => {
    expect(matchCommands('ORA').map(entry => entry.name)).toEqual(['oracle'])
  })

  it('finds nothing for a name nothing has', () => {
    expect(matchCommands('xyz')).toEqual([])
  })
})

describe('commandAtCaret', () => {
  it('finds a name being typed at the start of the draft', () => {
    expect(commandAtCaret('/', 1)).toEqual({ start: 0, end: 1, typed: '' })
    expect(commandAtCaret('/ora', 4)).toEqual({ start: 0, end: 4, typed: 'ora' })
  })

  it('finds one at the start of any line, after some space', () => {
    const text = 'I open the door.\n  /ora'

    expect(commandAtCaret(text, text.length)).toEqual({
      start: 19,
      end: text.length,
      typed: 'ora',
    })
  })

  it('leaves a slash in the middle of a line alone: that is punctuation', () => {
    expect(commandAtCaret('and/or', 4)).toBeNull()
    expect(commandAtCaret('It was 1/2', 9)).toBeNull()
  })

  it('stops once the name is followed by anything that is not part of one', () => {
    expect(commandAtCaret('/roll ', 6)).toBeNull()
    expect(commandAtCaret('/oracle(', 8)).toBeNull()
    expect(commandAtCaret('/path/to', 6)).toBeNull()
  })

  it('reaches to the end of a name the caret is inside, so all of it is replaced', () => {
    // The caret after `ora` in `/oracle Is it?`: finishing replaces `oracle`,
    // not just the three letters before the caret.
    expect(commandAtCaret('/oracle Is it?', 4)).toEqual({ start: 0, end: 7, typed: 'ora' })
  })

  it('says nothing for a caret outside the draft', () => {
    expect(commandAtCaret('/ora', 9)).toBeNull()
    expect(commandAtCaret('/ora', -1)).toBeNull()
    expect(commandAtCaret('', 0)).toBeNull()
  })

  it('finds a name on the line the caret is on, not the one above it', () => {
    const text = '/roll 3d6\nThen I run.'

    expect(commandAtCaret(text, text.length)).toBeNull()
    expect(commandAtCaret(text, 3)).toEqual({ start: 0, end: 5, typed: 'ro' })
  })
})

describe('runCommand', () => {
  it('answers in one of the four words the fiction can use', async () => {
    const command = await runCommand({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'likely',
    })

    expect(command).toMatchObject({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'likely',
      label: 'Is the door locked?',
    })
    expect(['yes', 'no', 'exceptional yes', 'exceptional no']).toContain(command.result)
  })

  it('assumes an even chance when the writer does not say', async () => {
    const command = await runCommand({ name: 'oracle', input: 'Is the door locked?' })

    // Resolved into the record, so asking again asks under the same odds.
    expect(command.param).toBe('fifty_fifty')
  })

  it('says the odds the way the writer would say them', async () => {
    // The value is written for the model, which picks it out of an enum.
    // Nobody reads "fifty_fifty".
    expect(commandDetail(await runCommand({ name: 'oracle', input: 'Is it?' }))).toBe('50/50')
    expect(
      commandDetail(await runCommand({ name: 'oracle', input: 'Is it?', param: 'very_likely' }))
    ).toBe('Very likely')
    expect(
      commandDetail(await runCommand({ name: 'oracle', input: 'Is it?', param: 'likely' }))
    ).toBe('Likely')
  })

  it('reads the odds off a record written before they were spelled out', () => {
    // Derived from the value the record kept, not from a second copy of it, so
    // an oracle rolled last week reads the same as one rolled today.
    expect(
      commandDetail({ name: 'oracle', input: 'Is it?', param: 'likely', detail: 'likely' })
    ).toBe('Likely')
  })

  it('shows a compaction only what it was told to favour, however old the record', () => {
    expect(
      commandDetail({ name: 'compact', input: '', param: '4', detail: 'keeping the last 4' })
    ).toBe('')
    expect(
      commandDetail({
        name: 'compact',
        input: 'favour the heist',
        detail: 'favour the heist · keeping the last 4',
      })
    ).toBe('favour the heist')
  })

  it('leaves the working of everything else as it was written', () => {
    // A roll's dice are not derivable from anything — they are what happened,
    // and they were written down at the time.
    expect(commandDetail({ name: 'roll', input: '3d6', detail: '4 + 1 + 6' })).toBe('4 + 1 + 6')
    expect(commandDetail({ name: 'cody', character: true, input: 'I hide.' })).toBe('')
  })

  it('says what it accepts when the likelihood is not one of them', async () => {
    const outcome = await runCommand({ name: 'oracle', input: 'Is it?', param: 'probably' })

    expect(outcome.error).toMatch(/probably/)
    expect(outcome.error).toMatch(/fifty_fifty/)
  })

  it('refuses parentheses on a command that has nothing to put in them', async () => {
    const outcome = await runCommand({ name: 'director', input: 'Wrap up', param: 'firmly' })

    expect(outcome.error).toMatch(/nothing in parentheses/i)
  })

  it('asks for a question rather than rolling on nothing', async () => {
    const outcome = await runCommand({ name: 'oracle', input: '' })

    expect(outcome.error).toMatch(/ask a question/i)
    expect(outcome.error).toContain(COMMANDS.oracle.usage)
  })

  it('names what there is when the command is not one of them', async () => {
    // The error the sigil buys back: with `/` a closed set, a name nothing
    // answers to is a mistake worth naming rather than a character.
    const outcome = await runCommand({ name: 'directr', input: 'Wrap this up' })

    expect(outcome.error).toMatch(/\/directr/)
    expect(outcome.error).toMatch(/\/oracle/)
    // And says where they would have gone if they meant a person.
    expect(outcome.error).toMatch(/@directr/)
  })

  it('answers to a command however it was capitalised', async () => {
    const command = await runCommand({ name: 'Oracle', input: 'Is it?', param: 'likely' })

    // Stored the one way it is spelled, so the record reads back the same
    // however it was typed.
    expect(command.name).toBe('oracle')
  })

  it('keeps what was typed, so asking again asks the same thing', async () => {
    const command = await runCommand({ name: 'oracle', input: 'Is it?', param: 'likely' })

    expect(command).toMatchObject({ input: 'Is it?', param: 'likely' })
  })

  it('offers every likelihood the oracle itself knows', () => {
    expect(LIKELIHOODS).toContain('fifty_fifty')
    expect(LIKELIHOODS).toContain('nearly_certain')
  })
})

describe('renderCommand', () => {
  it('tags the question and the answer under the command that answered', () => {
    const block = renderCommand({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'likely',
      label: 'Is the door locked?',
      detail: 'likely',
      result: 'yes',
    })

    expect(block).toBe('<oracle likelihood="likely">\nIs the door locked?\nyes\n</oracle>')
  })

  it('says what the writer thought of the odds, when they said', () => {
    // Not the working: what they thought before they rolled. A door that was
    // unlikely to be unlocked and is reads as luck; the same answer at even
    // odds reads as nothing at all.
    expect(
      renderCommand({
        name: 'oracle',
        input: 'Is the door unlocked?',
        param: 'unlikely',
        label: 'Is the door unlocked?',
        result: 'yes',
      })
    ).toBe('<oracle likelihood="unlikely">\nIs the door unlocked?\nyes\n</oracle>')
  })

  it('says nothing when the writer had no opinion', () => {
    // The default is the absence of a judgement, and it is most of them.
    expect(
      renderCommand({
        name: 'oracle',
        input: 'Is it?',
        param: 'fifty_fifty',
        label: 'Is it?',
        result: 'no',
      })
    ).toBe('<oracle>\nIs it?\nno\n</oracle>')
  })

  it('says nothing about the parameters that are settings rather than judgements', () => {
    expect(
      renderCommand({ name: 'compact', input: '', param: '12', result: 'They crossed.' })
    ).toBe('<summary>\nThey crossed.\n</summary>')
  })

  it('sends nothing about how the answer was reached', () => {
    // The same rule executeOracle follows for the model's own calls: a model
    // given the working narrates the working, and the player hears about the
    // odds instead of the door.
    const block = renderCommand({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'nearly_impossible',
      label: 'Is the door locked?',
      detail: 'nearly_impossible',
      result: 'no',
    })

    // The bucket it was asked under is one thing; the die and the target are
    // another, and they are what a model narrates the arithmetic of.
    expect(block).not.toContain('73')
    expect(block).toContain('Is the door locked?')
  })
})

describe('formatSegment', () => {
  it('writes a command back with the answer under it', () => {
    expect(
      formatSegment({
        type: 'command',
        command: {
          name: 'oracle',
          input: 'Is the door locked?',
          param: 'likely',
          label: 'Is the door locked?',
          result: 'no',
        },
      })
    ).toBe('/oracle(likely) Is the door locked?\n> no')
  })

  it('writes each line of a longer answer under its own mark', () => {
    expect(
      formatSegment({
        type: 'command',
        command: {
          name: 'name',
          input: '',
          param: 'female, 2',
          result: 'Emily Carter\nSarah Boyd',
        },
      })
    ).toBe('/name(female, 2)\n> Emily Carter\n> Sarah Boyd')
  })

  it('says nothing under a command whose answer is what it was given', () => {
    // A direction and a character's line would only be saying it twice.
    expect(
      formatSegment({
        type: 'command',
        command: { name: 'director', input: 'Wrap this up', result: 'Wrap this up' },
      })
    ).toBe('/director Wrap this up')
  })

  it('leaves prose as prose', () => {
    expect(formatSegment({ type: 'text', content: 'I try the handle.' })).toBe('I try the handle.')
  })

  it('round-trips a whole turn', () => {
    const turn = [
      { type: 'text', content: 'I check the fridge.' },
      {
        type: 'command',
        command: {
          name: 'oracle',
          input: 'Anything tasty?',
          param: 'likely',
          label: 'Anything tasty?',
          result: 'no',
        },
      },
    ]
    const text = formatTurn(turn)

    expect(text).toBe('I check the fridge.\n/oracle(likely) Anything tasty?\n> no')
    expect(splitInput(text)).toEqual([
      { type: 'text', content: 'I check the fridge.' },
      {
        type: 'command',
        name: 'oracle',
        param: 'likely',
        input: 'Anything tasty?',
        result: 'no',
      },
    ])
  })
})

describe('formatAnswered', () => {
  it('writes the answer under the command as it reads, unquoted', () => {
    const command = { name: 'compact', input: '', param: '4', result: 'They crossed.\n\n- Mira' }
    expect(formatAnswered(command)).toBe('/compact(4)\n\nThey crossed.\n\n- Mira')
  })

  it('writes the command alone when there is no answer to show', () => {
    expect(formatAnswered({ name: 'compact', input: '', param: '4' })).toBe('/compact(4)')
  })

  it('round-trips through splitAnswered', () => {
    const command = { name: 'compact', input: 'keep it short', param: '4', result: 'A\n> B\n/c' }
    expect(splitAnswered(formatAnswered(command))).toEqual([
      {
        type: 'command',
        name: 'compact',
        param: '4',
        input: 'keep it short',
        result: 'A\n> B\n/c',
      },
    ])
  })
})

describe('splitAnswered', () => {
  it('takes everything under the command as its answer, commands and quotes included', () => {
    expect(
      splitAnswered('/compact(2)\nThey crossed.\n\n/oracle is not a command here\n> nor this')
    ).toEqual([
      {
        type: 'command',
        name: 'compact',
        param: '2',
        input: '',
        result: 'They crossed.\n\n/oracle is not a command here\n> nor this',
      },
    ])
  })

  it('takes an answer quoted line by line out of its quotes', () => {
    expect(splitAnswered('/compact(2)\n> They crossed.\n>\n> - Mira')).toEqual([
      {
        type: 'command',
        name: 'compact',
        param: '2',
        input: '',
        result: 'They crossed.\n\n- Mira',
      },
    ])
  })

  it('has no answer when nothing is under the command', () => {
    expect(splitAnswered('/compact(2)\n\n')).toEqual([
      { type: 'command', name: 'compact', param: '2', input: '' },
    ])
  })

  it('reads text that does not open with a command as a turn, to be refused', () => {
    expect(splitAnswered('They crossed.')).toEqual([{ type: 'text', content: 'They crossed.' }])
  })
})

describe('splitInput', () => {
  it('keeps an ordinary message in one piece', () => {
    expect(splitInput('I try the handle.\nIt does not move.')).toEqual([
      { type: 'text', content: 'I try the handle.\nIt does not move.' },
    ])
  })

  it('lets a command follow the sentence it is about', () => {
    // The case a leading-slash test on the whole message cannot express, and
    // the one /director needs: the direction goes after the turn.
    expect(splitInput('I eat in silence.\n\n/director Wrap this scene up')).toEqual([
      { type: 'text', content: 'I eat in silence.' },
      { type: 'command', name: 'director', input: 'Wrap this scene up' },
    ])
  })

  it('keeps a run of commands in the order they were written', () => {
    const segments = splitInput('/oracle(likely) Is the door locked?\n/oracle Can they pick it?')

    expect(segments.map(segment => segment.input)).toEqual([
      'Is the door locked?',
      'Can they pick it?',
    ])
  })

  it('interleaves as written', () => {
    const segments = splitInput('/oracle(likely) Is it locked?\nI try anyway.\n/director Wrap up')

    expect(segments.map(segment => segment.type)).toEqual(['command', 'text', 'command'])
  })

  it('reads an answer written under the command it answers', () => {
    expect(splitInput('/oracle Is it locked?\n> no')).toEqual([
      { type: 'command', name: 'oracle', input: 'Is it locked?', result: 'no' },
    ])
  })

  it('gathers a longer answer line by line', () => {
    const [drawn] = splitInput('/name(female, 2)\n> Emily Carter\n> Sarah Boyd')

    expect(drawn.result).toBe('Emily Carter\nSarah Boyd')
  })

  it('leaves a blockquote alone where it is prose', () => {
    // Only the line directly under a command is an answer. Anywhere else `>`
    // is what it has always been.
    expect(splitInput('> she said, quietly')).toEqual([
      { type: 'text', content: '> she said, quietly' },
    ])
    expect(splitInput('/director Wrap up\n\n> a quote')).toEqual([
      { type: 'command', name: 'director', input: 'Wrap up' },
      { type: 'text', content: '> a quote' },
    ])
  })

  it('finds nothing in nothing', () => {
    expect(splitInput('')).toEqual([])
    expect(splitInput('   \n  ')).toEqual([])
  })
})

describe('/director', () => {
  it('takes the direction as given, having asked nothing', async () => {
    const command = await runCommand({ name: 'director', input: 'Wrap this scene up' })

    expect(command).toMatchObject({ name: 'director', result: 'Wrap this scene up' })
    expect(command.label).toBeUndefined()
  })

  it('renders under the tag the Director skill answers in', async () => {
    // From the Game Master's side these are the same thing: what the turn
    // needs, decided by whoever was better placed to decide it.
    const command = await runCommand({ name: 'director', input: 'Wrap this scene up' })

    expect(renderCommand(command)).toBe('<director>\nWrap this scene up\n</director>')
  })

  it('asks for a direction rather than recording an empty one', async () => {
    const outcome = await runCommand({ name: 'director', input: '' })

    expect(outcome.error).toMatch(/say what the turn needs/i)
    expect(outcome.error).toContain(COMMANDS.director.usage)
  })

  it('is the one command asking again cannot change', () => {
    // Its answer is the sentence it was given. There is nothing to retry, and
    // an edit simply runs it. See useChatCommands.
    expect(commandRepeatable({ name: 'director' })).toBe(false)
    expect(commandRepeatable({ name: 'oracle' })).toBe(true)
    expect(commandRepeatable({ name: 'roll' })).toBe(true)
    expect(commandRepeatable({ name: 'interpret' })).toBe(true)
    expect(commandRepeatable({ name: 'compact' })).toBe(true)
  })
})

describe('a character', () => {
  it('takes the line as given, under their own name', async () => {
    const command = await runCommand({
      name: 'cody',
      character: true,
      input: 'I quickly hide in the closet.',
    })

    expect(command).toMatchObject({
      name: 'cody',
      character: true,
      input: 'I quickly hide in the closet.',
      result: 'I quickly hide in the closet.',
    })
    expect(renderCommand(command)).toBe('<cody>\nI quickly hide in the closet.\n</cody>')
  })

  it('keeps the case the writer typed, because it is a name', async () => {
    const command = await runCommand({
      name: 'Emily',
      character: true,
      input: '"Ugh! I was having a nap!"',
    })

    expect(command.name).toBe('Emily')
    expect(renderCommand(command)).toBe('<Emily>\n"Ugh! I was having a nap!"\n</Emily>')
  })

  it('says nothing back and rolls nothing, so there is nothing to ask again', () => {
    expect(commandRepeatable({ name: 'cody', character: true })).toBe(false)
    expect(inspectCommand({ name: 'cody', character: true, input: 'I hide.' }).consults).toBe(false)
  })

  it('can be called after something that is also a command', async () => {
    // The record says which it is, so a character called Oracle is one — and
    // stays one whatever gets added to COMMANDS later.
    const command = await runCommand({ name: 'oracle', character: true, input: '"I see all."' })

    expect(command).toMatchObject({ character: true, result: '"I see all."' })
    expect(renderCommand(command)).toBe('<oracle>\n"I see all."\n</oracle>')
    expect(commandRepeatable(command)).toBe(false)
  })

  it('asks who and what rather than recording an empty line', () => {
    const { error } = inspectCommand({ name: 'emily', character: true, input: '' })

    expect(error).toMatch(/say what emily/i)
  })

  it('refuses parentheses, having nothing to put in them', () => {
    expect(
      inspectCommand({ name: 'emily', character: true, input: 'Hello.', param: 'shouting' }).error
    ).toMatch(/nothing in parentheses/i)
  })

  it('is typed and read back as the same line, sigil and all', () => {
    for (const line of ['@cody I quickly hide in the closet.', '/oracle(likely) Is it?']) {
      expect(formatCommand(parseCommand(line))).toBe(line)
    }
  })
})

describe('/roll', () => {
  it('answers with the total, and keeps the dice for the writer', async () => {
    // 0.5 of every side, so each die lands mid-range and the arithmetic is
    // the only thing under test.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({ name: 'roll', input: '3d6+2' })

    expect(command).toMatchObject({
      name: 'roll',
      input: '3d6+2',
      label: '3d6+2',
      result: '14',
      detail: '4 + 4 + 4 + 2',
    })
  })

  it('says nothing about the dice when the die is the answer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({ name: 'roll', input: 'd20' })

    expect(command.result).toBe('11')
    expect(command.detail).toBeUndefined()
  })

  it('sends the total and not the throw', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({ name: 'roll', input: '3d6+2' })

    expect(renderCommand(command)).toBe('<roll>\n3d6+2\n14\n</roll>')
  })

  it('refuses notation that is not dice, before anything is written', () => {
    const { error } = inspectCommand({ name: 'roll', input: 'a handful' })

    expect(error).toMatch(/not dice/i)
    expect(error).toContain(COMMANDS.roll.usage)
  })

  it('will not roll a die that would take all day', () => {
    expect(inspectCommand({ name: 'roll', input: '5000d6' }).error).toMatch(/between 1 and/i)
    expect(inspectCommand({ name: 'roll', input: 'd1000000' }).error).toMatch(/sides/i)
  })
})

describe('/roll-table', () => {
  it('rolls on the table the writer wrote, and keeps the table with the answer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // → the second of three

    const command = await runCommand({
      name: 'roll-table',
      input: '"a knife" "a letter" "nothing at all"',
    })

    expect(command).toMatchObject({
      name: 'roll-table',
      input: '"a knife" "a letter" "nothing at all"',
      label: '"a knife" "a letter" "nothing at all"',
      result: 'a letter',
    })
    // Which entry it was is working the writer can see for themselves.
    expect(commandDetail(command)).toBe('')
  })

  it('reads the options however they were separated, in whichever quotes the keyboard gave', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({
      name: 'roll-table',
      input: '“a knife”, "a letter",“nothing”',
    })

    expect(command.label).toBe('"a knife" "a letter" "nothing"')
    expect(command.result).toBe('a letter')
  })

  it('weights an option written twice', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({ name: 'roll-table', input: '"rain" "rain" "sun"' })

    expect(command.result).toBe('rain')
  })

  it('sends the table and the entry that came up', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const command = await runCommand({ name: 'roll-table', input: '"a" "b" "c"' })

    expect(renderCommand(command)).toBe('<roll-table>\n"a" "b" "c"\nb\n</roll-table>')
  })

  it('knows the table without rolling on it', () => {
    const { label, error } = inspectCommand({ name: 'roll-table', input: '"a" "b"' })

    expect(error).toBeUndefined()
    expect(label).toBe('"a" "b"')
  })

  it('names an option that lost its quotes rather than dropping it', () => {
    const { error } = inspectCommand({ name: 'roll-table', input: '"a knife" a letter' })

    expect(error).toMatch(/in quotes/i)
    expect(error).toContain(COMMANDS['roll-table'].usage)
  })

  it('refuses a table too short to roll on, and one too long to be one', () => {
    expect(inspectCommand({ name: 'roll-table', input: '' }).error).toMatch(/at least two/i)
    expect(inspectCommand({ name: 'roll-table', input: '"only"' }).error).toMatch(/at least two/i)

    const long = Array.from({ length: 101 }, (_, i) => `"${i}"`).join(' ')
    expect(inspectCommand({ name: 'roll-table', input: long }).error).toMatch(/at most 100/i)
  })

  it('refuses an option that says nothing', () => {
    expect(inspectCommand({ name: 'roll-table', input: '"a" "" "b"' }).error).toMatch(
      /say something/i
    )
  })

  it('refuses parentheses, having nothing to put in them', () => {
    const { error } = inspectCommand({ name: 'roll-table', param: 'loot', input: '"a" "b"' })

    expect(error).toMatch(/nothing in parentheses/i)
  })

  it('round-trips through the text of a turn with its answer under it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const command = await runCommand({ name: 'roll-table', input: '"a knife" "a letter"' })

    const text = formatSegment({ type: 'command', command })
    expect(text).toBe('/roll-table "a knife" "a letter"\n> a letter')
    expect(splitInput(text)).toEqual([
      { type: 'command', name: 'roll-table', input: '"a knife" "a letter"', result: 'a letter' },
    ])
  })

  it('rolls again when asked again', () => {
    expect(commandRepeatable({ name: 'roll-table' })).toBe(true)
  })
})

describe('/tarot', () => {
  it('turns over three cards from the Major Arcana, and keeps the question with them', async () => {
    const command = await runCommand({ name: 'tarot', input: 'Will she forgive him?' })

    expect(command.label).toBe('Will she forgive him?')

    const cards = command.result.match(/"[^"]+"/g)
    expect(cards).toHaveLength(3)
    expect(command.result).toBe(cards.join(' '))
    for (const card of cards) expect(MAJOR_ARCANA).toContain(card.slice(1, -1))
  })

  it('draws with nothing asked, which is a reading of the scene as it stands', async () => {
    const command = await runCommand({ name: 'tarot', input: '' })

    expect(command.label).toBeUndefined()
    expect(command.param).toBeUndefined()
    expect(command.result).toMatch(/^"[^"]+" "[^"]+" "[^"]+"$/)
    expect(commandDetail(command)).toBe('')
  })

  it('draws as many as asked', async () => {
    const one = await runCommand({ name: 'tarot', param: '1', input: '' })
    expect(one.result).toMatch(/^"[^"]+"$/)
    expect(commandDetail(one)).toBe('1 card')

    const five = await runCommand({ name: 'tarot', param: '5', input: '' })
    expect(five.result.match(/"[^"]+"/g)).toHaveLength(5)
    expect(commandDetail(five)).toBe('5 cards')
  })

  it('draws from the full deck when asked, and says so', async () => {
    // The bottom of the deck every time: the last card of whichever deck it is.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)

    const major = await runCommand({ name: 'tarot', param: '1', input: '' })
    expect(major.result).toBe('"The World"')

    const full = await runCommand({ name: 'tarot', param: '1, full', input: '' })
    expect(full.result).toBe('"King of Pentacles"')
    expect(commandDetail(full)).toBe('1 card, full deck')
  })

  it('takes the count and the deck in either order', async () => {
    const command = await runCommand({ name: 'tarot', param: 'full, 2', input: '' })

    expect(command.result.match(/"[^"]+"/g)).toHaveLength(2)
    expect(commandDetail(command)).toBe('2 cards, full deck')
  })

  it('says nothing about the deck when it is the usual one', async () => {
    const command = await runCommand({ name: 'tarot', param: 'major', input: '' })

    expect(commandDetail(command)).toBe('3 cards')
    for (const card of command.result.match(/"[^"]+"/g)) {
      expect(MINOR_ARCANA).not.toContain(card.slice(1, -1))
    }
  })

  it('never turns over the same card twice', async () => {
    // The top of the deck every time: three draws should be three cards.
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const command = await runCommand({ name: 'tarot', input: '' })

    expect(command.result).toBe('"The Fool" "The Magician" "The High Priestess"')
  })

  it('sends the question and the cards, and nothing about the deck', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const command = await runCommand({
      name: 'tarot',
      param: '3, full',
      input: 'What does he want?',
    })

    expect(renderCommand(command)).toBe(
      '<tarot>\nWhat does he want?\n"The Fool" "The Magician" "The High Priestess"\n</tarot>'
    )
  })

  it('refuses a count that is not one, and one nobody reads', () => {
    expect(inspectCommand({ name: 'tarot', param: '0', input: '' }).error).toMatch(/between 1 and/i)
    expect(inspectCommand({ name: 'tarot', param: '11', input: '' }).error).toMatch(
      /between 1 and/i
    )
    expect(inspectCommand({ name: 'tarot', param: '1.5', input: '' }).error).toMatch(/neither/i)
  })

  it('names the decks there are when asked for another', () => {
    const { error } = inspectCommand({ name: 'tarot', param: 'swords', input: '' })

    expect(error).toMatch(/neither/i)
    expect(error).toMatch(/major and full/)
    expect(error).toContain(COMMANDS.tarot.usage)
  })

  it('is typed and read back with what it was asked for', async () => {
    const command = await runCommand({ name: 'tarot', param: '1, full', input: 'Why?' })

    expect(formatSegment({ type: 'command', command })).toBe(
      `/tarot(1, full) Why?\n> ${command.result}`
    )
  })

  it('draws again when asked again', () => {
    expect(commandRepeatable({ name: 'tarot' })).toBe(true)
  })
})

describe('/name', () => {
  it('draws the names it was asked for', async () => {
    const command = await runCommand({ name: 'name', param: 'female, 3', input: '' })

    expect(command.result.split('\n')).toHaveLength(3)
    // One per line, and nothing about what was asked: that is in the parameter.
    // A surname can be more than one word (Van Dyke, St. John).
    expect(command.result.split('\n').every(name => /^\S+( \S+)+$/.test(name))).toBe(true)
    expect(command.label).toBeUndefined()
  })

  it('draws one when the writer does not say how many', async () => {
    const command = await runCommand({ name: 'name', param: 'male', input: '' })

    expect(command.result.split('\n')).toHaveLength(1)
  })

  it('lands in the conversation as names, which is what it produced', async () => {
    const command = await runCommand({ name: 'name', param: 'female, 1', input: '' })

    expect(renderCommand(command)).toBe(`<names>\n${command.result}\n</names>`)
  })

  it('says what it was asked for the way it would be said', async () => {
    const command = await runCommand({ name: 'name', param: 'male, 2', input: '' })

    expect(commandDetail(command)).toBe('2 male names')
    expect(commandDetail(await runCommand({ name: 'name', param: 'female', input: '' }))).toBe(
      'a female name'
    )
  })

  it('asks who to name rather than drawing from nothing', () => {
    const { error } = inspectCommand({ name: 'name', input: '' })

    expect(error).toMatch(/say who to name/i)
    expect(error).toContain(COMMANDS.name.usage)
  })

  it('names the two pools there are', () => {
    expect(inspectCommand({ name: 'name', param: 'neutral', input: '' }).error).toMatch(
      /female or male/
    )
  })

  it('refuses a count that is not one, and one nobody wants', () => {
    expect(inspectCommand({ name: 'name', param: 'female, lots', input: '' }).error).toMatch(
      /whole number/i
    )
    expect(inspectCommand({ name: 'name', param: 'female, 900', input: '' }).error).toMatch(
      /whole number/i
    )
    expect(inspectCommand({ name: 'name', param: 'female, 0', input: '' }).error).toMatch(
      /whole number/i
    )
  })

  it('refuses the prose it has no use for rather than dropping it', () => {
    // A sentence typed here was meant for the turn.
    const { error } = inspectCommand({
      name: 'name',
      param: 'female',
      input: 'she runs the inn',
    })

    expect(error).toMatch(/no words of its own/i)
  })

  it('draws again when asked again, which is the point of asking', () => {
    expect(commandRepeatable({ name: 'name' })).toBe(true)
  })
})

describe('/compact', () => {
  it('says what it will hold back, before it has anything to show', () => {
    expect(inspectCommand({ name: 'compact', input: '' })).toMatchObject({
      consults: true,
      keep: 0,
    })
    expect(inspectCommand({ name: 'compact', input: '' }).detail).toBeFalsy()
    expect(
      inspectCommand({ name: 'compact', input: 'favour the mystery', param: '8' }).detail
    ).toBe('favour the mystery')
  })

  it('refuses a count that is not one, before anything is written', () => {
    const { error } = inspectCommand({ name: 'compact', input: '', param: 'lots' })

    expect(error).toMatch(/whole number/i)
    expect(error).toContain(COMMANDS.compact.usage)
  })

  it('reads the tail it is keeping too', async () => {
    const consult = vi.fn().mockResolvedValue('They crossed the pass in early winter.')

    await runCommand({ name: 'compact', input: 'favour the mystery', param: '6' }, { consult })

    const [prompt, tools, options] = consult.mock.calls[0]
    expect(prompt).toContain('favour the mystery')
    // A summary needs no tools, and reads under the ordinary names: compaction
    // happens to any chat, not only to one being played at a table.
    expect(tools).toBeUndefined()
    expect(options.roles).toBeUndefined()
    // Kept so the next turn has a scene to continue, not because the summary
    // leaves them out: it sits above them and reads past itself that far.
    expect(options.past).toBe(6)
    expect(options).not.toHaveProperty('keep')
  })

  it('takes one count and no more', () => {
    const { error } = inspectCommand({ name: 'compact', input: '', param: '1, 3' })

    expect(error).toMatch(/whole number/i)
  })

  it('keeps the count with the summary, so the same range reads back', async () => {
    const consult = vi.fn().mockResolvedValue('They crossed the pass.')

    const command = await runCommand({ name: 'compact', input: '', param: '4' }, { consult })

    expect(command).toMatchObject({
      name: 'compact',
      keep: 4,
      result: 'They crossed the pass.',
    })
  })

  it('knows the count without running, so an edited one moves the summary', () => {
    // The one part of a preview that is not only for reading: it is how far
    // above the end of the conversation the summary sits.
    expect(askedCommand({ name: 'compact', input: '', param: '9' }).keep).toBe(9)
  })

  it('lands in the conversation as a summary, which is what it is', async () => {
    // The writer types an instruction; what the model reads is the thing that
    // instruction produced. And the note beside it — what was asked for, how
    // much was held back — is the writer's, so it never goes.
    const consult = vi.fn().mockResolvedValue('They crossed the pass.')
    const command = await runCommand({ name: 'compact', input: 'favour the mystery' }, { consult })

    expect(renderCommand(command)).toBe('<summary>\nThey crossed the pass.\n</summary>')
    expect(renderCommand(command)).not.toContain('favour the mystery')
    expect(renderCommand(command)).not.toContain('keeping the last')
  })

  it('says so when there is no model to ask, and when nothing came back', async () => {
    expect((await runCommand({ name: 'compact', input: '' })).error).toMatch(/no conversation/i)

    const consult = vi.fn().mockResolvedValue('')
    expect((await runCommand({ name: 'compact', input: '' }, { consult })).error).toMatch(
      /nothing came back/i
    )
  })
})

describe('/interpret', () => {
  it('says it costs a model call, which the others do not', () => {
    // The caller has to know before it writes: a command that consults is
    // written before it has an answer.
    expect(inspectCommand({ name: 'interpret', input: 'What is he afraid of?' })).toMatchObject({
      consults: true,
      // What it is asking, for the box the writer looks at while it runs.
      label: 'What is he afraid of?',
    })
    expect(inspectCommand({ name: 'oracle', input: 'Is it?' }).consults).toBe(false)
    expect(inspectCommand({ name: 'director', input: 'Wrap up' }).consults).toBe(false)
    expect(inspectCommand({ name: 'roll', input: 'd20' }).consults).toBe(false)
  })

  it('refuses an empty question without needing a model to say so', () => {
    // The last point at which refusing costs nothing. After it there is a
    // message in the chat carrying whatever went wrong.
    const { error } = inspectCommand({ name: 'interpret', input: '' })

    expect(error).toMatch(/needs something to go on/i)
    expect(error).toContain(COMMANDS.interpret.usage)
  })

  it('is not what an unknown name is, which is somebody', () => {
    expect(inspectCommand({ name: 'cody', input: 'I hide.' }).consults).toBe(false)
  })

  it('asks the skill, and keeps the question with the answer', async () => {
    const consult = vi.fn().mockResolvedValue('He is waiting for someone who never came.')

    const command = await runCommand(
      { name: 'interpret', input: 'What is this innkeeper afraid of?' },
      { consult }
    )

    expect(consult).toHaveBeenCalledTimes(1)
    expect(command).toMatchObject({
      name: 'interpret',
      label: 'What is this innkeeper afraid of?',
      result: 'He is waiting for someone who never came.',
    })
  })

  it('says so when there is no model to ask', async () => {
    const outcome = await runCommand({ name: 'interpret', input: 'What is he afraid of?' })

    expect(outcome.error).toMatch(/not available/i)
  })

  it('renders as the question and what came of it', async () => {
    const consult = vi.fn().mockResolvedValue('He is waiting for someone.')
    const command = await runCommand(
      { name: 'interpret', input: 'What is he afraid of?' },
      { consult }
    )

    expect(renderCommand(command)).toBe(
      '<interpret>\nWhat is he afraid of?\nHe is waiting for someone.\n</interpret>'
    )
  })

  it('carries the question through the states where there is no answer', () => {
    // The wait and the failure both keep it: it is the part the writer wrote,
    // and the part they would otherwise have to retype.
    const parsed = { name: 'interpret', input: 'What is he afraid of?' }

    expect(pendingCommand(parsed)).toEqual({
      name: 'interpret',
      input: 'What is he afraid of?',
      label: 'What is he afraid of?',
      result: '',
      pending: true,
    })
    expect(askedCommand(parsed).pending).toBeUndefined()
  })

  it('renders as the bare question while it has no answer yet', () => {
    // What a pending or failed one leaves in the conversation. The question is
    // the part worth keeping either way.
    expect(renderCommand({ name: 'interpret', label: 'What is he afraid of?', result: '' })).toBe(
      '<interpret>\nWhat is he afraid of?\n</interpret>'
    )
  })
})

describe('/write', () => {
  it('costs a model call and answers on a turn of its own', () => {
    // A scene is not a piece of the writer's turn, and it is written before it
    // has an answer so the writer can watch it arrive.
    expect(
      inspectCommand({ name: 'write', input: 'The scene where Riley turns up.' })
    ).toMatchObject({
      consults: true,
      repeatable: true,
      // The brief, for the box the writer looks at while it runs.
      detail: 'The scene where Riley turns up.',
    })
    expect(commandTakesTurn({ name: 'write' })).toBe(true)
    expect(commandRepeatable({ name: 'write' })).toBe(true)
  })

  it('refuses an empty brief without needing a model to say so', () => {
    const { error } = inspectCommand({ name: 'write', input: '' })

    expect(error).toMatch(/needs something to go on/i)
    expect(error).toContain(COMMANDS.write.usage)
  })

  it('asks the skill, and keeps the brief beside the draft', async () => {
    const consult = vi.fn().mockResolvedValue('The laptop burned through his jeans.')

    const command = await runCommand(
      { name: 'write', input: 'The scene where Riley turns up.' },
      { consult }
    )

    expect(consult).toHaveBeenCalledTimes(1)
    expect(command).toMatchObject({
      name: 'write',
      input: 'The scene where Riley turns up.',
      detail: 'The scene where Riley turns up.',
      result: 'The laptop burned through his jeans.',
    })
    // Beside, not under: the brief is the writer's to read and never sent.
    expect(command.label).toBeUndefined()
    expect(commandDetail(command)).toBe('The scene where Riley turns up.')

    // The skill reads the project and never writes to it.
    const [, tools] = consult.mock.calls[0]
    expect(tools).toEqual([
      'list_documents',
      'read_document',
      'describe_document',
      'search_documents',
    ])
  })

  it('says so when there is no model to ask', async () => {
    const outcome = await runCommand({ name: 'write', input: 'A scene.' })

    expect(outcome.error).toMatch(/no model/i)
    expect(outcome.error).toContain(COMMANDS.write.usage)
  })

  it('renders as a draft holding the prose alone', async () => {
    // What lands in the conversation is a draft, and the model reads it as one:
    // the brief stays off the wire, so nothing inside the tag is not prose.
    const consult = vi.fn().mockResolvedValue('The laptop burned through his jeans.')
    const command = await runCommand({ name: 'write', input: 'A scene.' }, { consult })

    expect(commandTag(command)).toBe('draft')
    expect(renderCommand(command)).toBe('<draft>\nThe laptop burned through his jeans.\n</draft>')
  })

  it('is edited as the line that asked it', () => {
    expect(formatCommand({ name: 'write', input: 'The scene where Riley turns up.' })).toBe(
      '/write The scene where Riley turns up.'
    )
  })
})

describe('assembleTurn', () => {
  it('keeps a skill the writer dropped, which goes only at the next summary', () => {
    const command = { name: 'tighten', input: '', prompt: true, load: true, result: 'Cut it.' }

    expect(
      assembleTurn([
        { type: 'text', content: 'Look at this.' },
        { type: 'command', command: { ...command, dropped: true } },
      ])
    ).toBe('Look at this.\n\n<tighten>\nCut it.\n</tighten>')
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'

const getServerPrompt = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  getServerPrompt,
}))

import { setServers } from '@/mcp/servers.js'
import {
  COMMANDS,
  commandAtCaret,
  commandIsPrompt,
  commandSpeaks,
  inspectCommand,
  matchCommands,
  parseCommand,
  renderCommand,
  runCommand,
} from '@/ai/commands.js'

const glossary = {
  id: 'mcp_glossary',
  name: 'Glossary',
  prefix: 'glossary',
  url: 'http://localhost:8765/mcp',
  tools: [],
  prompts: [
    {
      name: 'outline',
      description: 'Ask for an outline of a piece on a topic.',
      arguments: [{ name: 'topic', required: true }],
    },
    { name: 'Weekly Notes', description: 'The team’s weekly notes template.' },
    {
      name: 'compare',
      arguments: [
        { name: 'first', required: true },
        { name: 'second', required: true },
      ],
    },
  ],
  profiles: [],
  allowed: [],
  created: 1,
  updated: 1,
}

const said = text => ({ messages: [{ role: 'user', content: { type: 'text', text } }] })

afterEach(() => {
  setServers([])
  getServerPrompt.mockReset()
})

describe('a server’s prompt as a command', () => {
  it('reads /server:prompt as one name, and @Name: as a character saying the rest', () => {
    expect(parseCommand('/glossary:outline the lighthouse')).toEqual({
      name: 'glossary:outline',
      input: 'the lighthouse',
    })
    expect(parseCommand('@Vivi:hi there')).toEqual({
      name: 'Vivi',
      character: true,
      input: ':hi there',
    })
    expect(parseCommand('@Vivi: I hide')).toMatchObject({ name: 'Vivi', input: ': I hide' })
  })

  it('finds the name being typed past the colon', () => {
    expect(commandAtCaret('/glossary:out', 13)).toEqual({
      start: 0,
      end: 13,
      typed: 'glossary:out',
    })
  })

  it('offers each prompt that takes at most one argument, by the server’s prefix', () => {
    setServers([glossary])

    expect(COMMANDS['glossary:outline'].usage).toBe('/glossary:outline <topic>')
    expect(COMMANDS['glossary:outline'].description).toBe(
      'Ask for an outline of a piece on a topic.'
    )
    expect(COMMANDS['glossary:weekly-notes'].usage).toBe('/glossary:weekly-notes')
    // Two things to fill in, and one line to fill them from.
    expect(COMMANDS['glossary:compare']).toBeUndefined()
  })

  it('takes the commands away with the server', () => {
    setServers([glossary])
    setServers([])

    expect(COMMANDS['glossary:outline']).toBeUndefined()
  })

  it('is found in the menu by the prompt’s own name', () => {
    setServers([glossary])

    expect(matchCommands('outline').map(entry => entry.name)).toContain('glossary:outline')
  })

  it('puts what the server sends back into the writer’s turn, under its name', async () => {
    setServers([glossary])
    getServerPrompt.mockResolvedValue(
      said('Outline a short piece about the lighthouse, in five beats.')
    )

    const ran = await runCommand(parseCommand('/glossary:outline the lighthouse'))

    expect(getServerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mcp_glossary' }),
      'outline',
      { topic: 'the lighthouse' }
    )
    expect(ran).toMatchObject({
      name: 'glossary:outline',
      prompt: true,
      detail: 'the lighthouse',
      result: 'Outline a short piece about the lighthouse, in five beats.',
    })
    expect(commandIsPrompt(ran)).toBe(true)
    expect(commandSpeaks(ran)).toBe(true)
    expect(renderCommand(ran)).toBe(
      '<glossary:outline>\nOutline a short piece about the lighthouse, in five beats.\n</glossary:outline>'
    )
  })

  it('puts what was typed after a prompt that takes nothing', async () => {
    setServers([glossary])
    getServerPrompt.mockResolvedValue(said('Fill in the weekly notes.'))

    const ran = await runCommand(parseCommand('/glossary:weekly-notes for the March launch'))

    expect(getServerPrompt).toHaveBeenCalledWith(expect.anything(), 'Weekly Notes', {})
    expect(ran.result).toBe('Fill in the weekly notes.\n\nARGUMENTS: for the March launch')
  })

  it('asks for the argument a prompt needs before sending anything', () => {
    setServers([glossary])

    expect(inspectCommand(parseCommand('/glossary:outline')).error).toMatch(/needs its topic/)
    expect(getServerPrompt).not.toHaveBeenCalled()
  })

  it('says why a server could not give the prompt', async () => {
    setServers([glossary])
    getServerPrompt.mockRejectedValue({ data: { status: 401 } })

    const ran = await runCommand(parseCommand('/glossary:outline the lighthouse'))

    expect(ran.error).toMatch(/sign in/)
  })
})

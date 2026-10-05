import { describe, it, expect, vi } from 'vitest'
import {
  executeWrite,
  buildWritePrompt,
  WRITE_PROMPT,
  WRITE_TOOLS,
  WRITE_SETTINGS,
} from '@/ai/skills/write/index.js'
import { getToolDefinitions } from '@/ai/tools/index.js'

/**
 * The tools a prompt tells the model to call, out of everything registered.
 * Matched as a prompt writes one — `name(args)`, or in backticks — so ordinary
 * prose using the same English word is not mistaken for a call.
 *
 * @param {string} prompt
 * @returns {string[]}
 */
const toolsNamedIn = prompt =>
  getToolDefinitions()
    .map(definition => definition.function.name)
    .filter(name => new RegExp('`' + name + '`|\\b' + name + '\\s*\\(').test(prompt))

describe('write skill', () => {
  describe('prompt', () => {
    it('is loaded and trimmed', () => {
      expect(WRITE_PROMPT.length).toBeGreaterThan(0)
      expect(WRITE_PROMPT).toBe(WRITE_PROMPT.trim())
    })

    it('tells the model to call nothing it has not been given', () => {
      // What this prompt says is the harness's question, not a unit test's —
      // it is rewritten every time the scores move, and pinning its sentences
      // would mean editing this file on every pass. What is checked here is
      // the one thing that spans two files: a tool named in the prompt but
      // missing from the list is an instruction to call something that is not
      // on offer. Not the reverse — definitions go out with the request, so a
      // granted tool the prompt never mentions is still one the model sees.
      expect(WRITE_TOOLS).toEqual(expect.arrayContaining(toolsNamedIn(WRITE_PROMPT)))
    })
  })

  describe('buildWritePrompt', () => {
    it('carries the role and the brief', () => {
      const prompt = buildWritePrompt('The scene where Riley turns up.')

      expect(prompt).toContain(WRITE_PROMPT)
      expect(prompt).toContain('## The brief')
      expect(prompt).toContain('The scene where Riley turns up.')
    })
  })

  describe('tools', () => {
    it('reads the project and never writes to it', () => {
      expect(WRITE_TOOLS).toEqual([
        'list_documents',
        'read_document',
        'describe_document',
        'search_documents',
      ])
      expect(WRITE_TOOLS.some(name => /create|edit|append|update/.test(name))).toBe(false)
    })
  })

  describe('execute', () => {
    it('consults on the brief with the reading tools, and hands back the draft', async () => {
      const consult = vi.fn().mockResolvedValue('The laptop burned through his jeans.')

      const result = await executeWrite({ brief: 'The scene where Riley turns up.' }, { consult })

      expect(result).toEqual({ draft: 'The laptop burned through his jeans.' })
      expect(consult).toHaveBeenCalledTimes(1)

      const [prompt, tools, options] = consult.mock.calls[0]
      expect(prompt).toContain('The scene where Riley turns up.')
      expect(tools).toEqual(WRITE_TOOLS)
      expect(options.overrides).toBe(WRITE_SETTINGS)
      // Under the default names: a piece is asked for in any chat, not at the table.
      expect(options.roles).toBeUndefined()
    })

    it('refuses an empty brief without consulting', async () => {
      const consult = vi.fn()

      expect((await executeWrite({ brief: '   ' }, { consult })).error).toMatch(
        /say what to write/i
      )
      expect((await executeWrite({}, { consult })).error).toMatch(/say what to write/i)
      expect(consult).not.toHaveBeenCalled()
    })

    it('says so when there is no model to ask', async () => {
      const result = await executeWrite({ brief: 'A scene.' })

      expect(result).toEqual({ error: expect.stringMatching(/no model/i) })
    })

    it('reports a draft that never came', async () => {
      const consult = vi.fn().mockResolvedValue('')

      const result = await executeWrite({ brief: 'A scene.' }, { consult })

      expect(result).toEqual({ error: expect.stringMatching(/nothing came back/i) })
    })
  })

  describe('as a tool', () => {
    it('has one to be called by, and is not offered while its file says not', async () => {
      const { getSkill } = await import('@/ai/skills/index.js')
      const write = getSkill('write')

      expect(typeof write.execute).toBe('function')
      expect(write.model).toBe(false)
      expect(getToolDefinitions().map(d => d.function.name)).not.toContain('write')
    })

    it('tells the model to pass the request on and leave the notes to it', async () => {
      const { getSkill, toolDefinitionFor } = await import('@/ai/skills/index.js')
      const { function: tool } = toolDefinitionFor(getSkill('write'))

      expect(tool.description).toMatch(/call this rather than writing it yourself/)
      expect(tool.description).toMatch(/Don't summarise or quote the notes/)
      expect(tool.description).toMatch(/your turn ends there/)
      expect(tool.parameters.properties.brief.description).toMatch(/in their words/)
    })
  })
})

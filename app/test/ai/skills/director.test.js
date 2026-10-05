import { describe, it, expect, vi } from 'vitest'
import {
  directorDefinition,
  executeDirector,
  buildDirectionBlock,
  DIRECTOR_PROMPT,
  DIRECTOR_TOOLS,
  DIRECTOR_SETTINGS,
} from '@/ai/skills/director/index.js'
/** What the transcript the Director reads calls the two voices at the table. */
const TABLE_ROLES = { user: 'player', assistant: 'game_master' }
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

describe('director skill', () => {
  describe('definition', () => {
    it('takes no arguments', () => {
      expect(directorDefinition.function.name).toBe('director')
      expect(directorDefinition.function.parameters.properties).toEqual({})
      expect(directorDefinition.function.parameters.required).toBeUndefined()
    })

    it('says the answer never reaches the player', () => {
      // When to call it is the Game Master's prompt to say; what comes back is
      // this description's. A Game Master that thinks the direction is
      // narration quotes it at the player.
      expect(directorDefinition.function.description).toMatch(/never speaks to the player/i)
    })

    it('warns the caller not to re-roll what the Director already asked', () => {
      // The whole reason it has the dice. A Game Master that rolls the same
      // question again gets a second answer and narrates past the first.
      expect(directorDefinition.function.description).toMatch(/rather than rolling it again/i)
    })
  })

  describe('tools', () => {
    it('asks for the tools that settle what the fiction has not', () => {
      expect(DIRECTOR_TOOLS).toContain('oracle')
    })

    it('asks for nothing that writes', () => {
      // It advises; the Game Master puts things on the page. A Director with
      // the document tools is a second writer inside one turn.
      for (const name of DIRECTOR_TOOLS) {
        expect(name).not.toMatch(/document|generate_names/)
      }
    })

    it('does not ask for itself', () => {
      expect(DIRECTOR_TOOLS).not.toContain('director')
    })
  })

  describe('prompt', () => {
    it('is loaded and trimmed', () => {
      expect(DIRECTOR_PROMPT.length).toBeGreaterThan(0)
      expect(DIRECTOR_PROMPT).toBe(DIRECTOR_PROMPT.trim())
    })

    it('tells the model to call nothing it has not been given', () => {
      // The one thing about this prompt that is not the prompt's own business:
      // a tool named here but not granted is an instruction to call something
      // that is not on offer, and that does not show up until a game is
      // running. Not the reverse — the definitions go out with the request, so
      // a tool the prompt never mentions is still one the model can see.
      //
      // Nothing about the wording is asserted. The prompt is the tuning
      // surface: it is meant to be rewritten, and a test that pins its
      // sentences makes every rewrite cost a test edit until somebody stops
      // reading the failures. What it produces is the harness's question, and
      // the harness runs a model to ask it.
      expect(DIRECTOR_TOOLS).toEqual(expect.arrayContaining(toolsNamedIn(DIRECTOR_PROMPT)))
    })
  })

  describe('execute', () => {
    it('consults with the director prompt and returns what came back', async () => {
      const consult = vi.fn().mockResolvedValue('The scene has run long. Move to the meeting.')

      const result = await executeDirector({}, { storyId: 'story_1', chatId: 'chat_1', consult })

      // The names the Director's own prompt uses, so the transcript it reads
      // needs no translating.
      expect(consult).toHaveBeenCalledWith(DIRECTOR_PROMPT, DIRECTOR_TOOLS, {
        roles: TABLE_ROLES,
        overrides: DIRECTOR_SETTINGS,
      })
      expect(result).toEqual({ direction: 'The scene has run long. Move to the meeting.' })
    })

    it('reports an error rather than throwing when nothing can run it', async () => {
      // A skill is a plain function of its arguments; the inference belongs to
      // whoever is running the turn. Called outside one, it says so, and the
      // model narrates without direction instead of the turn failing.
      const result = await executeDirector({}, { storyId: 'story_1' })

      expect(result).toEqual({ error: expect.stringMatching(/not available/i) })
    })

    it('reports an error when the Director said nothing', async () => {
      const consult = vi.fn().mockResolvedValue('')

      const result = await executeDirector({}, { consult })

      expect(result).toEqual({ error: expect.stringMatching(/nothing to say/i) })
    })

    it('survives being called with no context at all', async () => {
      const result = await executeDirector({})

      expect(result).toEqual({ error: expect.stringMatching(/not available/i) })
    })
  })

  describe('direction block', () => {
    it('carries the direction and names who it is from', () => {
      // It arrives as text at the tail of the conversation, where anything
      // unlabelled reads as something the writer typed.
      const block = buildDirectionBlock('Stay in the scene.')

      expect(block).toContain('<director>')
      expect(block).toContain('Stay in the scene.')
    })

    it('closes the block as well as opening it', () => {
      // A heading opens a section and nothing closes one. A Game Master that
      // cannot tell where the direction stops carries its voice into the
      // narration.
      expect(buildDirectionBlock('Stay in the scene.').trimEnd()).toMatch(/<\/director>$/)
    })

    it('spends no words telling the Game Master not to call the Director', () => {
      // The turn withholds the tool on this path, so there is nothing to call.
      expect(buildDirectionBlock('Stay in the scene.')).not.toMatch(/do not call/i)
    })

    it('carries the direction and nothing the Director thought', () => {
      // Only what executeDirector returns can reach here, and that is the
      // direction alone — but say so, because the block is what the Game
      // Master reads and a working shown is a working narrated.
      const block = buildDirectionBlock('  Stay in the scene.  ')

      expect(block).toBe('<director>\nStay in the scene.\n</director>')
    })
  })
})

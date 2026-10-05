import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toolRegistry } from '@/ai/tools/registry.js'

describe('ToolRegistry', () => {
  // Create a fresh registry for each test to avoid state leakage
  let registry

  beforeEach(() => {
    // Clear the singleton registry's tools for testing
    toolRegistry.tools.clear()
    registry = toolRegistry
  })

  describe('register', () => {
    it('should register a tool', () => {
      const definition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      }
      const execute = vi.fn()

      registry.register('test_tool', definition, execute)

      expect(registry.tools.has('test_tool')).toBe(true)
    })

    it('should overwrite existing tool with same name', () => {
      const definition1 = {
        type: 'function',
        function: { name: 'test_tool', description: 'First' },
      }
      const definition2 = {
        type: 'function',
        function: { name: 'test_tool', description: 'Second' },
      }

      registry.register('test_tool', definition1, vi.fn())
      registry.register('test_tool', definition2, vi.fn())

      const definitions = registry.getDefinitions()
      expect(definitions).toHaveLength(1)
      expect(definitions[0].function.description).toBe('Second')
    })
  })

  describe('getDefinitions', () => {
    it('should return empty array when no tools registered', () => {
      expect(registry.getDefinitions()).toEqual([])
    })

    it('should return all registered tool definitions', () => {
      const definition1 = {
        type: 'function',
        function: { name: 'tool1', description: 'Tool 1' },
      }
      const definition2 = {
        type: 'function',
        function: { name: 'tool2', description: 'Tool 2' },
      }

      registry.register('tool1', definition1, vi.fn())
      registry.register('tool2', definition2, vi.fn())

      const definitions = registry.getDefinitions()

      expect(definitions).toHaveLength(2)
      expect(definitions).toContainEqual(definition1)
      expect(definitions).toContainEqual(definition2)
    })
  })

  describe('groups', () => {
    const def = name => ({ type: 'function', function: { name, description: '', parameters: {} } })

    beforeEach(() => {
      registry.register('read_lore', def('read_lore'), vi.fn(), 'lore')
      registry.register('write_lore', def('write_lore'), vi.fn(), 'lore')
      registry.register('roll_dice', def('roll_dice'), vi.fn(), 'rpg')
    })

    it('arranges tools by group in label order', () => {
      const groups = registry.getGroups({ rpg: 'Dice', lore: 'Lore' })

      expect(groups.map(g => g.id)).toEqual(['rpg', 'lore'])
      expect(groups[1].label).toBe('Lore')
      expect(groups[1].definitions.map(d => d.function.name)).toEqual(['read_lore', 'write_lore'])
    })

    it('omits groups with no registered tools', () => {
      expect(registry.getGroups({ lore: 'Lore', empty: 'Empty' }).map(g => g.id)).toEqual(['lore'])
    })

    it('offers everything when nothing is disabled', () => {
      expect(registry.getEnabledDefinitions().map(d => d.function.name)).toEqual([
        'read_lore',
        'write_lore',
        'roll_dice',
      ])
    })

    it('withholds a named tool', () => {
      const names = registry
        .getEnabledDefinitions({ disabledTools: ['write_lore'] })
        .map(d => d.function.name)

      expect(names).toEqual(['read_lore', 'roll_dice'])
    })

    it('withholds every member of a disabled group', () => {
      const names = registry
        .getEnabledDefinitions({ disabledGroups: ['lore'] })
        .map(d => d.function.name)

      // Neither lore tool was named individually — that's the point of a group.
      expect(names).toEqual(['roll_dice'])
    })

    it('withholds a tool added to a disabled group later', () => {
      registry.register('search_lore', def('search_lore'), vi.fn(), 'lore')

      const names = registry
        .getEnabledDefinitions({ disabledGroups: ['lore'] })
        .map(d => d.function.name)

      expect(names).not.toContain('search_lore')
    })

    it('ignores an unknown group id', () => {
      expect(registry.getEnabledDefinitions({ disabledGroups: ['retired'] })).toHaveLength(3)
    })
  })

  describe('getDefinitionsFor', () => {
    const def = name => ({ type: 'function', function: { name, description: '', parameters: {} } })

    beforeEach(() => {
      registry.register('read_lore', def('read_lore'), vi.fn(), 'lore')
      registry.register('roll_dice', def('roll_dice'), vi.fn(), 'rpg')
      registry.register('oracle', def('oracle'), vi.fn(), 'rpg')
    })

    it("withholds nothing — what a skill may reach for is the skill's business", () => {
      // The chat's tool switches are about the assistant the writer is talking
      // to. A skill is not that assistant, and this is not where they apply.
      const names = registry.getDefinitionsFor(['oracle', 'read_lore']).map(d => d.function.name)

      expect(names).toEqual(['oracle', 'read_lore'])
    })

    it('returns the named tools, in the order they were asked for', () => {
      const names = registry.getDefinitionsFor(['oracle', 'roll_dice']).map(d => d.function.name)

      expect(names).toEqual(['oracle', 'roll_dice'])
    })

    it('offers nothing that was not named', () => {
      const names = registry.getDefinitionsFor(['oracle']).map(d => d.function.name)

      expect(names).toEqual(['oracle'])
    })

    it('drops a name that matches nothing rather than raising', () => {
      // A skill naming a tool that has since been renamed loses that tool.
      // Failing here would fail the turn that consulted it.
      const names = registry.getDefinitionsFor(['oracle', 'retired_tool']).map(d => d.function.name)

      expect(names).toEqual(['oracle'])
    })

    it('offers nothing for an empty or missing list', () => {
      expect(registry.getDefinitionsFor([])).toEqual([])
      expect(registry.getDefinitionsFor(undefined)).toEqual([])
    })
  })

  describe('execute', () => {
    it('should execute registered tool', async () => {
      const definition = {
        type: 'function',
        function: { name: 'greet', description: 'Greet someone' },
      }
      const execute = vi.fn().mockResolvedValue({ message: 'Hello, World!' })

      registry.register('greet', definition, execute)

      const toolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'greet',
          arguments: '{"name":"World"}',
        },
      }

      const result = await registry.execute(toolCall)

      expect(execute).toHaveBeenCalledWith({ name: 'World' }, {})
      expect(result.tool_call_id).toBe('call_123')
      expect(JSON.parse(result.content)).toEqual({ message: 'Hello, World!' })
    })

    it('should return error for unknown tool', async () => {
      const toolCall = {
        id: 'call_456',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: '{}',
        },
      }

      const result = await registry.execute(toolCall)

      expect(result.tool_call_id).toBe('call_456')
      expect(JSON.parse(result.content)).toEqual({ error: 'Unknown tool: unknown_tool' })
    })

    it('should handle execution errors', async () => {
      const definition = {
        type: 'function',
        function: { name: 'failing_tool', description: 'A tool that fails' },
      }
      const execute = vi.fn().mockRejectedValue(new Error('Execution failed'))

      registry.register('failing_tool', definition, execute)

      const toolCall = {
        id: 'call_789',
        type: 'function',
        function: {
          name: 'failing_tool',
          arguments: '{}',
        },
      }

      const result = await registry.execute(toolCall)

      expect(result.tool_call_id).toBe('call_789')
      expect(JSON.parse(result.content)).toEqual({ error: 'Execution failed' })
    })

    it('should handle invalid JSON arguments', async () => {
      const definition = {
        type: 'function',
        function: { name: 'test_tool', description: 'Test' },
      }
      const execute = vi.fn()

      registry.register('test_tool', definition, execute)

      const toolCall = {
        id: 'call_invalid',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: 'not valid json',
        },
      }

      const result = await registry.execute(toolCall)

      expect(result.tool_call_id).toBe('call_invalid')
      const content = JSON.parse(result.content)
      expect(content.error).toBeDefined()
    })
  })

  describe('hasTools', () => {
    it('should return false when no tools registered', () => {
      expect(registry.hasTools()).toBe(false)
    })

    it('should return true when tools are registered', () => {
      registry.register('test', { type: 'function', function: { name: 'test' } }, vi.fn())

      expect(registry.hasTools()).toBe(true)
    })
  })
})

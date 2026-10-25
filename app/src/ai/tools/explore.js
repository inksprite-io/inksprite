/**
 * @module ai/tools/explore
 * @description `explore_documents`: the model asking for a folder, a
 * document, or the whole project to be explored, and waiting for it.
 *
 * Explore is a finding aid (see `jobs/explore.js`): a paragraph on what was
 * explored and a line on each document in it, written by another request
 * from their text, for the model to know where to read. So the answer is
 * that paragraph and the listing with its lines, which is small, and the
 * model reads what they point to; it is not handed the text. For one
 * document it is the paragraph and the document's sections, with a line on
 * each long one, as `describe_document` gives them. What is
 * current is not read again, so a second call over the same folder answers
 * at once.
 *
 * The writer reads the answer as it is, in the turn where the call was made
 * (`ToolContext.show`), and the model is told so: it says what it makes of
 * it rather than repeating it. One that reads a lot asks the writer first,
 * with its size. It runs on the model the chat runs on (`ToolContext.preset`).
 *
 * The writer's `/explore` runs the same thing (`exploreFor`), and writes
 * the answer into their turn.
 */

import { exploreNode } from '@/jobs/index.js'
import { exploreNow, exploredName } from '@/composables/useExplore.js'
import { sectionTree } from '@/utils/sections.js'
import {
  digestAbout,
  documentForChat,
  executeListDocuments,
  sectionLines,
  withSectionLines,
} from './documents.js'
import { sectionsOfText } from './slices.js'

/** @typedef {import('./registry.js').ToolContext} ToolContext */

/** The tool's name. */
export const EXPLORE_DOCUMENTS = 'explore_documents'

/**
 * How long a call may take: a shelf of books is an hour of requests on a
 * model at home, and the wait to be allowed is in it too.
 */
export const EXPLORE_TIMEOUT_MS = 3 * 60 * 60 * 1000

/** @type {import('./registry.js').ToolDefinition} */
export const exploreDocumentsDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: EXPLORE_DOCUMENTS,
    description:
      'Explore a folder, a document, or the whole project, for a question that needs a wide look and when you do not know where to read. Another model reads the text and writes a paragraph on what was explored and a line on each document in it, saying what it is about, and on each long section of a document; it answers with the paragraph and the listing with those lines, or for one document its sections. Then read what they point you to. The lines are kept, and list_documents shows them from then on; what has not changed since is not read again, so exploring it again is quick. The user sees the answer as you do, so do not repeat it. A large one asks the user first. For one fact, search_documents is quicker.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The folder or document to explore, by its path from the project root. Default "/", the whole project.',
        },
      },
    },
  },
}

/**
 * What exploring answers with.
 *
 * @typedef {Object} Explored
 * @property {string} path - What was explored, as the tools give it: a folder's with a slash
 * @property {string} name - What it is called in a heading: `Notes/`, `the project`
 * @property {string} about - Explore's paragraph on it
 * @property {string} [listing] - For a folder: what it holds, with each line
 * @property {import('@/utils/sections.js').SectionNode[]} [sections] - For a
 *   document: its long sections, each with its line, and the sections they
 *   are in. `describe_document` gives the whole tree.
 */

/**
 * The sections that have a line, and the ones they are in: the rest of the
 * tree is `describe_document`'s to give.
 *
 * @param {import('@/utils/sections.js').SectionNode[]} nodes
 * @returns {import('@/utils/sections.js').SectionNode[]}
 */
function linedOnly(nodes) {
  return nodes.flatMap(node => {
    const below = linedOnly(node.sections || [])
    if (!node.about && below.length === 0) return []
    const { link, title, words, about } = node
    return [
      {
        link,
        title,
        words,
        ...(about ? { about } : {}),
        ...(below.length > 0 ? { sections: below } : {}),
      },
    ]
  })
}

/**
 * Explore something and say what it holds: for the model's call and the
 * writer's command alike, each with its own way of asking first.
 *
 * @param {string} asked - The path, as typed or called; empty for the project
 * @param {ToolContext} context
 * @returns {Promise<Explored|{declined: true}|{error: string}>}
 */
export async function exploreFor(asked, context) {
  if (!context?.storyId) return { error: 'There is no project to explore.' }
  const path = asked.trim() || '/'
  const found = await documentForChat(context.storyId, context.chatId, path)
  const node = found ? exploreNode(found.document.id) : null
  if (!found || !node) return { error: `There is nothing at "${path}".` }
  if (node.leftOut) return { error: `"${path}" is ${node.leftOut}, which explore leaves out.` }

  let outcome
  try {
    outcome = await exploreNow(context.storyId, node.id, {
      signal: context.signal,
      progress: context.progress,
      approve: context.approve,
      preset: context.preset,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  if ('declined' in outcome) return outcome
  if ('error' in outcome) {
    return { error: `${outcome.error} What it had described is kept; exploring again goes on.` }
  }

  // As the chat reads it, with a card's names filled in.
  const explored = (await documentForChat(context.storyId, context.chatId, path))?.document
  const about = explored?.digest ? digestAbout(explored.digest) : ''
  if (!about) return { error: `There is nothing in "${path}" to read.` }
  const shown = found.path === '/' ? '/' : node.type === 'folder' ? `${found.path}/` : found.path
  // What it holds, listed: a folder's, or a document's that holds others.
  const listing =
    node.type === 'folder' || node.children.length > 0
      ? await executeListDocuments({ path: found.path }, context)
      : null
  if (node.type !== 'folder') {
    const lines = sectionLines(explored?.digest)
    const tree = withSectionLines(
      sectionTree(sectionsOfText(explored?.content || ''), Infinity, Infinity),
      lines
    )
    const described = lines.size > 0 ? linedOnly(tree) : []
    return {
      path: shown,
      name: exploredName(node),
      about,
      ...(described.length > 0 ? { sections: described } : {}),
      ...(typeof listing === 'string' ? { listing } : {}),
    }
  }
  return {
    path: shown,
    name: exploredName(node),
    about,
    ...(typeof listing === 'string' ? { listing } : {}),
  }
}

/**
 * The model's call: explore, show the writer what came of it, and answer
 * with the same.
 *
 * @param {{path?: string}} args
 * @param {ToolContext} [context]
 * @returns {Promise<Record<string, any>>}
 */
export async function executeExploreDocuments(args, context = {}) {
  const asked = typeof args?.path === 'string' ? args.path : ''
  const outcome = await exploreFor(asked, context)
  // Without a way to ask, only what reads little is explored.
  if ('declined' in outcome) {
    return {
      error: context.approve
        ? 'The user chose not to explore it.'
        : 'It reads too much to explore without asking the user.',
    }
  }
  if ('error' in outcome) return outcome
  const { name, ...answer } = outcome
  context.show?.({
    title: `Explored ${name}`,
    icon: 'pi-compass',
    text: answer.about,
    ...(answer.listing ? { more: { title: 'Listing', text: answer.listing } } : {}),
    ...(answer.sections ? { more: { title: 'Sections', text: outline(answer.sections) } } : {}),
  })
  return { ...answer, note: 'The user sees this too.' }
}

/**
 * A document's sections as plain lines, indented by depth: each title, and
 * the line on it where there is one.
 *
 * @param {import('@/utils/sections.js').SectionNode[]} nodes
 * @param {number} [depth]
 * @returns {string}
 */
export function outline(nodes, depth = 0) {
  return nodes
    .flatMap(node => {
      const indent = '  '.repeat(depth)
      const said = node.about ? ` — ${node.about}` : ''
      const counted = node.entries ? ` (${node.entries} entries: ${node.range})` : ''
      const below = node.sections ? [outline(node.sections, depth + 1)] : []
      return [`${indent}${node.title}${counted}${said}`, ...below]
    })
    .join('\n')
}

/**
 * What the writer's `/explore` puts in their turn: the paragraph, and what
 * a folder holds or a document's sections under it, as the model reads it.
 *
 * @param {Explored} explored
 * @returns {string}
 */
export function exploredText(explored) {
  const under = explored.listing || (explored.sections ? outline(explored.sections) : '')
  if (!under) return explored.about
  return `${explored.about}\n\n\`\`\`\n${under}\n\`\`\``
}

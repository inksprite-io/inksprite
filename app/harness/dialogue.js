/**
 * @module harness/dialogue
 * @description The command that runs a scene and writes it down.
 *
 * The architecture itself is in `scene.js`; this reads the spec, runs it as
 * many times as asked, and renders the exchange, the Director's changes, the
 * bids that lost, and the narrated prose into a file a reader can score
 * against `scoring-dialogue.md`.
 *
 * @example
 * npm run dialogue -- --scene heat-wave --endpoint lmstudio --turns 16
 * npm run dialogue -- --scene heat-wave --thinking on --no-silence --runs 3
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEndpoint } from './endpoints.js'
import { DIRECT_EVERY, narrate, runScene } from './scene.js'

/** @typedef {import('./scene.js').Bid} Bid */
/** @typedef {import('./scene.js').SceneState} SceneState */

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @param {SceneState} state
 * @param {{title: string, lines: string[], prose?: string}} head
 * @returns {string}
 */
function render(state, head) {
  const out = [`# ${head.title}`, '', ...head.lines, '']

  out.push('## Exchange', '')
  for (const turn of state.turns) {
    const who = state.speakers[turn.speaker].name
    if (turn.silence) out.push(`**${who}.** _(${turn.action || 'says nothing'})_`)
    else {
      out.push(`**${who}.** ${turn.line}`)
      if (turn.action) out.push(`_(${turn.action})_`)
    }
    out.push('')
  }

  const directions = state.log.filter(entry => entry.director)
  if (directions.length > 0) {
    out.push('## Director', '')
    for (const { director } of directions) {
      if (director.error) {
        out.push(`- after turn ${director.afterTurn}: error — ${director.error}`)
        continue
      }
      const changed = Object.entries(director.updates || {}).filter(([id]) => id !== 'moved')
      const moved = director.updates?.moved
      out.push(
        `- after turn ${director.afterTurn}, landed at ${director.landedAfter} (${(director.ms / 1000).toFixed(1)}s${director.finish && director.finish !== 'stop' ? `, cut off: ${director.finish}` : ''})${moved ? ` — moved: ${moved}` : ''}${changed.length === 0 ? ' — no change' : ''}`
      )
      for (const [id, update] of changed) {
        if (update.objective) out.push(`  - ${id} wants: ${update.objective}`)
        if (update.belief) out.push(`  - ${id} thinks: ${update.belief}`)
      }
    }
    out.push('')
  }

  out.push('## Bids not taken', '')
  for (const entry of state.log.filter(item => item.round)) {
    const losers = entry.bids.filter(bid => bid.speaker !== entry.won)
    for (const bid of losers) {
      const what = bid.pass ? '_pass_' : `"${bid.line}"`
      out.push(`- round ${entry.round}, ${state.speakers[bid.speaker].name}: ${what}`)
    }
  }
  out.push('')

  if (head.prose) out.push('## Narrated', '', head.prose, '')
  return out.join('\n')
}

/**
 * @typedef {Object} Options
 * @property {string} [scene]
 * @property {string} [endpoint]
 * @property {string} [model]
 * @property {number} turns
 * @property {number} runs
 * @property {boolean} thinking
 * @property {boolean} narrate
 * @property {boolean} silence
 * @property {string} out
 */

const USAGE = `
Usage: npm run dialogue -- --scene <name> [options]

  -s, --scene <name|path>   Scene under harness/scenes/, or a path to one
  -e, --endpoint <name>     Endpoint from scripts/endpoints.local.json
  -m, --model <id>          Model to run, overriding the endpoint's
  -t, --turns <n>           Cap on committed lines (default: 12)
  -n, --runs <n>            How many times to run the scene (default: 1)
      --thinking <on|off>   Whether speaker calls may think (default: off, per the design note)
      --no-narrate          Stop after the exchange; skip the prose pass
      --no-silence          Hand the beat back to the last speaker when the
                            other passes, instead of recording the silence
  -o, --out <dir>           Where to write (default: harness/runs)
`

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const options = {
    turns: 12,
    runs: 1,
    thinking: false,
    narrate: true,
    silence: true,
    out: join(HERE, 'runs'),
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    switch (arg) {
      case '--scene':
      case '-s':
        options.scene = value()
        break
      case '--endpoint':
      case '-e':
        options.endpoint = value()
        break
      case '--model':
      case '-m':
        options.model = value()
        break
      case '--turns':
      case '-t':
        options.turns = Number.parseInt(value(), 10)
        break
      case '--runs':
      case '-n':
        options.runs = Number.parseInt(value(), 10)
        break
      case '--thinking': {
        const mode = value()
        if (mode !== 'on' && mode !== 'off') throw new Error('--thinking must be on or off')
        options.thinking = mode === 'on'
        break
      }
      case '--no-narrate':
        options.narrate = false
        break
      case '--no-silence':
        options.silence = false
        break
      case '--out':
      case '-o':
        options.out = resolve(value())
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${arg}\n${USAGE}`)
    }
  }
  if (!options.scene) throw new Error(`--scene is required\n${USAGE}`)
  return options
}

/**
 * Read a scene spec, loading any sketch a speaker keeps in a file.
 *
 * @param {string} ref
 * @returns {Promise<any>}
 */
async function loadScene(ref) {
  const file = ref.endsWith('.json') ? resolve(ref) : join(HERE, 'scenes', `${ref}.json`)
  const spec = JSON.parse(await readFile(file, 'utf8'))
  for (const [id, speaker] of Object.entries(spec.speakers)) {
    const person = /** @type {any} */ (speaker)
    person.id = id
    if (person.sketchFile) {
      person.sketch = (await readFile(resolve(dirname(file), person.sketchFile), 'utf8')).trim()
    }
  }
  spec.name = basename(file, '.json')
  return spec
}

/** @param {number} ms */
const seconds = ms => `${(ms / 1000).toFixed(1)}s`

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const spec = await loadScene(options.scene)
  const endpoint = await resolveEndpoint(options.endpoint)
  const model = options.model || endpoint.model
  if (!model) throw new Error(`Endpoint ${endpoint.name} names no model; pass --model`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(options.out, `${stamp}-dialogue-${spec.name}`)
  await mkdir(outDir, { recursive: true })

  const meta = {
    scene: spec.name,
    endpoint: endpoint.name,
    model,
    thinking: options.thinking,
    silence: options.silence,
    turnCap: options.turns,
    directEvery: DIRECT_EVERY,
    sceneSha: createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 12),
    started: new Date().toISOString(),
    /** @type {any[]} */
    runs: [],
  }

  process.stdout.write(`${spec.name} on ${endpoint.name} / ${model}\n`)
  process.stdout.write(
    `speaker thinking ${options.thinking ? 'on' : 'off'}, cap ${options.turns} lines, director every ${DIRECT_EVERY}\n`
  )
  process.stdout.write(`writing to ${outDir}\n\n`)

  for (let n = 1; n <= options.runs; n++) {
    const started = Date.now()
    /** @type {any} */
    const record = { n }
    try {
      const state = await runScene(spec, {
        endpoint,
        model,
        thinking: options.thinking,
        turns: options.turns,
        silence: options.silence,
        // A scene is minutes of calls on a local model. Without this the run
        // is silent until it is over, which is indistinguishable from hung.
        onRound: round => {
          const slowest = Math.max(...round.bids.map((/** @type {Bid} */ bid) => bid.ms))
          const passes = round.bids.filter((/** @type {Bid} */ bid) => bid.pass).length
          const won = round.bids.find((/** @type {Bid} */ bid) => bid.speaker === round.won)
          const said = won?.line
            ? `${spec.speakers[round.won].name}: ${won.line.slice(0, 60)}`
            : 'nobody spoke'
          process.stdout.write(
            `  round ${String(round.round).padStart(2)}  ${seconds(slowest).padStart(6)}  ${passes} pass  ${said}\n`
          )
        },
      })

      /** @type {{prose: string, finish: string, ms: number}|null} */
      let narrated = null
      if (options.narrate) {
        narrated = await narrate(state, {
          endpoint,
          model,
          narration: spec.narration || 'Third person limited.',
        })
      }

      const rounds = state.log.filter(entry => entry.round)
      const passes = rounds.reduce(
        (sum, entry) => sum + entry.bids.filter((/** @type {Bid} */ bid) => bid.pass).length,
        0
      )
      const durationMs = Date.now() - started

      await writeFile(
        join(outDir, `run-${n}.md`),
        render(state, {
          title: `${spec.name} — run ${n}`,
          lines: [
            `${endpoint.name} / ${model} · speaker thinking ${options.thinking ? 'on' : 'off'} · ${seconds(durationMs)}`,
          ],
          prose: narrated?.prose,
        })
      )
      await writeFile(
        join(outDir, `run-${n}.json`),
        JSON.stringify({ turns: state.turns, speakers: state.speakers, log: state.log }, null, 2)
      )

      Object.assign(record, {
        durationMs,
        lines: state.turns.length,
        silences: state.turns.filter(turn => turn.silence).length,
        rounds: rounds.length,
        passes,
        directorRuns: state.log.filter(entry => entry.director).length,
        narrationMs: narrated?.ms,
        ...(narrated && narrated.finish !== 'stop' ? { narrationCutOff: narrated.finish } : {}),
      })
      process.stdout.write(
        `run ${n}/${options.runs}  ${seconds(durationMs).padStart(8)}  ${String(state.turns.length).padStart(2)} lines  ${passes} passes  ${record.directorRuns} director runs\n`
      )
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      process.stdout.write(`run ${n}/${options.runs}  failed: ${record.error}\n`)
    } finally {
      meta.runs.push(record)
      await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
    }
  }

  process.stdout.write(`\nwritten to ${outDir}\n`)
}

// Only when run as the command. Importing this module — to probe one stage of
// it, or to test the parser and the arbiter — should not start a scene.
main()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  })

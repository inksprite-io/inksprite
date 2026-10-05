/* global URLSearchParams */
/**
 * A small MCP server for trying InkSprite's connections against, with nothing
 * else to sign up for.
 *
 * Streamable HTTP, answering every request with JSON (no event streams), and
 * a session per client the way a hosted server keeps one. Three tools — one
 * that reads, one that writes, so the chat has to ask before it runs, and one
 * that fails — and a prompt.
 *
 *   npm run mcp-server                      # http://localhost:8765/mcp
 *   npm run mcp-server -- --port 9000
 *   npm run mcp-server -- --key secret      # wants Authorization: Bearer secret
 *   npm run mcp-server -- --no-cors         # answers no page, the way many hosted servers don't
 *   npm run mcp-server -- --oauth           # wants signing in, the way Linear and Notion do
 *   npm run mcp-server -- --oauth --expires 30   # with tokens that lapse in 30 seconds
 *
 * With `--oauth` it is its own authorization server, as the spec lays one
 * out: protected-resource metadata named in its 401, authorization-server
 * metadata, Dynamic Client Registration, a page to allow or deny on, PKCE
 * (S256) checked at the token endpoint, and refresh tokens.
 *
 * Nothing it keeps outlives it.
 */

import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const PORT = Number(option('port') || 8765)
const KEY = option('key')
const CORS = !args.includes('--no-cors')
const OAUTH = args.includes('--oauth')
const EXPIRES = Number(option('expires') || 3600)

/** Where it answers, once it knows its port. */
let BASE = ''

/** Registered clients, by id: the addresses each may be sent back to. */
const clients = new Map()
/** Codes waiting to be traded for tokens. */
const codes = new Map()
/** Access tokens, with when each lapses; refresh tokens, by client. */
const accessTokens = new Map()
const refreshTokens = new Map()

const sessions = new Set()
/** @type {string[]} */
const notes = []

const GLOSSARY = {
  kenning: 'A compound that names a thing by what it does or resembles: "whale-road" for the sea.',
  litotes: 'Saying something by denying its opposite: "not bad" for good.',
  synecdoche: 'A part named for the whole: "hands" for workers.',
}

const TOOLS = [
  {
    name: 'look_up',
    title: 'Look up a term',
    description: 'Look up a term of rhetoric in the glossary.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { term: { type: 'string', description: 'The term, e.g. kenning' } },
      required: ['term'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'save_note',
    title: 'Save a note',
    description: 'Save a short note to the server.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'break',
    description: 'Always fails, for checking how a failure reads.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
]

const PROMPTS = [
  {
    name: 'outline',
    description: 'Ask for an outline of a piece on a topic.',
    arguments: [{ name: 'topic', description: 'What it is about', required: true }],
  },
]

/**
 * @param {string} name
 * @param {Record<string, any>} input
 */
function callTool(name, input) {
  if (name === 'look_up') {
    const term = String(input.term || '').toLowerCase()
    const found = GLOSSARY[term]
    return found
      ? { content: [{ type: 'text', text: `${term}: ${found}` }] }
      : { content: [{ type: 'text', text: `No entry for "${term}".` }], isError: true }
  }
  if (name === 'save_note') {
    notes.push(String(input.text || ''))
    return { content: [{ type: 'text', text: `Saved note #${notes.length}.` }] }
  }
  if (name === 'break') {
    return { content: [{ type: 'text', text: 'It broke, as it always does.' }], isError: true }
  }
  return null
}

/**
 * @param {any} message
 * @param {string|undefined} session
 * @returns {{result?: any, error?: {code: number, message: string}, session?: string}}
 */
function handle(message, session) {
  const { method, params = {} } = message
  if (method === 'initialize') {
    const id = randomUUID()
    sessions.add(id)
    return {
      session: id,
      result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'InkSprite test server', version: '1.0.0' },
        instructions: 'A glossary of rhetoric, and a place to keep notes.',
      },
    }
  }
  if (!session || !sessions.has(session)) {
    return { error: { code: -32001, message: 'Session not found' } }
  }
  if (method === 'ping') return { result: {} }
  if (method === 'tools/list') return { result: { tools: TOOLS } }
  if (method === 'prompts/list') return { result: { prompts: PROMPTS } }
  if (method === 'tools/call') {
    const result = callTool(params.name, params.arguments || {})
    return result
      ? { result }
      : { error: { code: -32602, message: `Unknown tool: ${params.name}` } }
  }
  if (method === 'prompts/get' && params.name === 'outline') {
    const topic = params.arguments?.topic || 'something'
    return {
      result: {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Outline a short piece about ${topic}, in five beats.` },
          },
        ],
      },
    }
  }
  return { error: { code: -32601, message: `Method not found: ${method}` } }
}

/**
 * The whole body of a request, read as JSON or a form, whichever it is.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      if ((req.headers['content-type'] || '').includes('application/json')) {
        try {
          return resolve(JSON.parse(body))
        } catch {
          return resolve({})
        }
      }
      resolve(Object.fromEntries(new URLSearchParams(body)))
    })
  })
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {any} body
 */
function sendJson(res, status, headers, body) {
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** @param {string} text */
const escapeHtml = text =>
  String(text).replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

/** A fresh pair of tokens for a client. */
function issueTokens(clientId) {
  const access = randomUUID()
  const refresh = randomUUID()
  accessTokens.set(access, Date.now() + EXPIRES * 1000)
  refreshTokens.set(refresh, clientId)
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: EXPIRES,
    refresh_token: refresh,
  }
}

/**
 * The authorization server's side of the protocol, when it is one. True when
 * it answered the request.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Record<string, string>} cors
 * @returns {Promise<boolean>}
 */
async function handleOAuth(req, res, cors) {
  const url = new URL(req.url || '/', BASE)

  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    sendJson(res, 200, cors, {
      resource: `${BASE}/mcp`,
      authorization_servers: [BASE],
      bearer_methods_supported: ['header'],
    })
    return true
  }

  if (url.pathname === '/.well-known/oauth-authorization-server') {
    sendJson(res, 200, cors, {
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    })
    return true
  }

  if (url.pathname === '/register' && req.method === 'POST') {
    const metadata = await readBody(req)
    const id = randomUUID()
    clients.set(id, metadata.redirect_uris || [])
    console.log(`registered ${metadata.client_name || 'a client'}`)
    sendJson(res, 201, cors, {
      ...metadata,
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: 'none',
    })
    return true
  }

  if (url.pathname === '/authorize' && req.method === 'GET') {
    const q = url.searchParams
    const redirects = clients.get(q.get('client_id'))
    if (!redirects || !redirects.includes(q.get('redirect_uri'))) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Unknown client, or an address it may not be sent back to.')
      return true
    }
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Only the code flow, with PKCE (S256).')
      return true
    }
    const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'resource']
      .map(name => `<input type="hidden" name="${name}" value="${escapeHtml(q.get(name) || '')}">`)
      .join('')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><title>Sign in</title>
<body style="font-family:sans-serif;max-width:28rem;margin:4rem auto">
<h1>Test server</h1>
<p>InkSprite would like to use your notes and the glossary.</p>
<form method="post" action="/authorize">${hidden}
<button name="decision" value="allow">Allow</button>
<button name="decision" value="deny">Deny</button>
</form></body>`)
    return true
  }

  if (url.pathname === '/authorize' && req.method === 'POST') {
    const form = await readBody(req)
    const back = new URL(form.redirect_uri)
    if (form.state) back.searchParams.set('state', form.state)
    back.searchParams.set('iss', BASE)
    if (form.decision !== 'allow') {
      back.searchParams.set('error', 'access_denied')
    } else {
      const code = randomUUID()
      codes.set(code, {
        clientId: form.client_id,
        redirectUri: form.redirect_uri,
        challenge: form.code_challenge,
        expires: Date.now() + 60000,
      })
      back.searchParams.set('code', code)
    }
    res.writeHead(302, { Location: back.toString() })
    res.end()
    return true
  }

  if (url.pathname === '/token' && req.method === 'POST') {
    const form = await readBody(req)
    if (form.grant_type === 'authorization_code') {
      const pending = codes.get(form.code)
      codes.delete(form.code)
      const verified =
        pending &&
        pending.expires > Date.now() &&
        pending.clientId === form.client_id &&
        pending.redirectUri === form.redirect_uri &&
        createHash('sha256')
          .update(form.code_verifier || '')
          .digest('base64url') === pending.challenge
      if (!verified) {
        sendJson(res, 400, cors, { error: 'invalid_grant' })
        return true
      }
      console.log('signed in')
      sendJson(res, 200, cors, issueTokens(form.client_id))
      return true
    }
    if (form.grant_type === 'refresh_token') {
      const clientId = refreshTokens.get(form.refresh_token)
      refreshTokens.delete(form.refresh_token)
      if (!clientId) {
        sendJson(res, 400, cors, { error: 'invalid_grant' })
        return true
      }
      console.log('refreshed')
      sendJson(res, 200, cors, issueTokens(clientId))
      return true
    }
    sendJson(res, 400, cors, { error: 'unsupported_grant_type' })
    return true
  }

  return false
}

/**
 * Whether a request to the server itself carries a token that is good.
 *
 * @param {http.IncomingMessage} req
 */
function authorized(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const lapses = accessTokens.get(token)
  return Boolean(lapses && lapses > Date.now())
}

/** @param {http.IncomingMessage} req */
function corsHeaders(req) {
  if (!CORS) return {}
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'content-type, mcp-session-id, mcp-protocol-version, authorization, last-event-id',
    'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
  }
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  if (OAUTH && (await handleOAuth(req, res, cors))) return
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404, cors)
    return res.end()
  }
  if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401, { ...cors, 'WWW-Authenticate': 'Bearer' })
    return res.end()
  }
  if (OAUTH && !authorized(req)) {
    const lapsed = Boolean(req.headers.authorization)
    res.writeHead(401, {
      ...cors,
      'WWW-Authenticate': `Bearer${lapsed ? ' error="invalid_token",' : ''} resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
    })
    return res.end()
  }
  const session = /** @type {string|undefined} */ (req.headers['mcp-session-id'])
  if (req.method === 'DELETE') {
    if (session) sessions.delete(session)
    res.writeHead(200, cors)
    return res.end()
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...cors, Allow: 'POST, DELETE' })
    return res.end()
  }

  let body = ''
  req.on('data', chunk => (body += chunk))
  req.on('end', () => {
    let message
    try {
      message = JSON.parse(body)
    } catch {
      res.writeHead(400, cors)
      return res.end()
    }
    // A notification, or a response to something we never asked: nothing to say.
    if (message.id === undefined || !message.method) {
      res.writeHead(202, cors)
      return res.end()
    }
    const answer = handle(message, session)
    if (answer.error?.code === -32001) {
      res.writeHead(404, { ...cors, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: answer.error }))
    }
    console.log(`${message.method}${message.params?.name ? ` ${message.params.name}` : ''}`)
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'application/json',
      ...(answer.session ? { 'Mcp-Session-Id': answer.session } : {}),
    })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        ...(answer.error ? { error: answer.error } : { result: answer.result }),
      })
    )
  })
})

server.listen(PORT, () => {
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  BASE = `http://localhost:${port}`
  const traits = [KEY && 'wants a key', OAUTH && 'wants signing in', !CORS && 'no CORS'].filter(
    Boolean
  )
  console.log(`MCP test server on ${BASE}/mcp${traits.length ? ` (${traits.join(', ')})` : ''}`)
})

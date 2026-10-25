/**
 * @module cloud/api
 * @description The sync server, as the device asks it: JSON over HTTP with
 * a bearer token, bytes as base64, a file's parts as they are, and a stream
 * of the collections that changed.
 *
 * The design is `.llm/sync_design.md`, "The protocol".
 */

import { fromBase64, toBase64 } from './crypto.js'

/** @typedef {import('./crypto.js').Bytes} Bytes */

/** Our sync service, the only server a build without dev features (`config/dev.js`) signs in to. */
export const HOSTED_SERVER = 'https://sync.inksprite.io'

/** A request the server refused, or one that never reached it. */
export class CloudError extends Error {
  /**
   * @param {string} message
   * @param {number} status - The server's answer; 0 when there was none
   * @param {Record<string, unknown>} [extra] - The rest of what it said
   */
  constructor(message, status, extra = {}) {
    super(message)
    this.name = 'CloudError'
    this.status = status
    this.extra = extra
  }
}

/**
 * A collection as the server lists it, its keys still wrapped.
 * @typedef {Object} ListedCollection
 * @property {string} id
 * @property {number} seq
 * @property {number} epoch
 * @property {number|null} deleted
 * @property {boolean} [kept] - Deleted because a device keeps the project to itself
 * @property {string} role - `owner`, or `member` of a project shared with this account
 * @property {Bytes} key
 * @property {Bytes|null} meta
 * @property {number} [owner] - The owner's account; none from a server before sharing
 * @property {number} [members] - How many are in it, the owner among them
 * @property {boolean} [shared] - Ever shared: its chats are each one's own
 * @property {boolean} [selective] - Shared with only some of its documents, the
 *   others its owner's own
 * @property {boolean} [sealed] - Its key is wrapped for this account's public key
 * @property {boolean} [left] - This account left it, or was removed: its key is gone
 */

/**
 * @typedef {Object} PulledRecord
 * @property {string} name
 * @property {number} rev
 * @property {Bytes|null} body
 * @property {boolean} [own] - This account's own, sealed under its own key
 */

/**
 * Taken, a conflict with the server's own, or refused: for the room it would
 * take past the quota, or for being another account's own.
 * @typedef {{name: string, rev: number}|{name: string, conflict: {rev: number, body: Bytes|null, own?: boolean}}|{name: string, refused: 'quota'|'own'}} PushResult
 */

/**
 * Someone in a shared project.
 * @typedef {Object} Member
 * @property {number} account
 * @property {boolean} owner
 * @property {string|null} display - The name they show the people they share with
 */

/**
 * The account, as the server keeps it for its devices.
 * @typedef {Object} AccountRecord
 * @property {string} name
 * @property {Bytes} salt
 * @property {import('./crypto.js').Kdf} kdf
 * @property {Bytes} key - The account key, wrapped under the passphrase
 * @property {boolean} recovery - Whether a recovery code was made
 * @property {{used: number, quota: number|null}} [usage] - What the account
 *   keeps and may keep, in bytes; no quota for no limit. None from an older server.
 * @property {boolean} [diagnostics] - Whether the server wants them
 * @property {number} [id] - None from a server before sharing
 * @property {string|null} [display] - The name the people it shares with see
 * @property {Bytes} [publicKey] - Its key pair's, once one is made
 * @property {Bytes} [privateKey] - Sealed under the account key
 */

/**
 * A device signed in to the account.
 * @typedef {Object} Device
 * @property {string} id
 * @property {string|null} device - What it calls itself
 * @property {number} created
 * @property {number} used - To the hour
 * @property {boolean} current - This one
 */

/**
 * Proof that a device knows what signs in already, for changing it: the
 * passphrase's sign-in key, or the recovery code's.
 * @typedef {{current: Bytes}|{recovery: Bytes}} Proof
 */

/** @param {Proof} proof */
const proofOf = proof =>
  'current' in proof ? { current: toBase64(proof.current) } : { recovery: toBase64(proof.recovery) }

/** This build's version, as Settings › About shows it; none on the test server. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || ''

/**
 * What this app speaks of the protocol, for the server to hold an older app
 * back from a collection ever shared: 2 knows a record may be one account's
 * own, and 3 which of a project's documents its owner shares with no one.
 */
export const PROTOCOL = 3

/**
 * The server at this address, as one device signed in to it, or not yet.
 *
 * @param {string} server - Its address, `https://sync.example.com`; https is
 *   assumed when no scheme is given
 * @param {string|null} [token]
 * @param {{fetch?: typeof fetch, app?: string}} [options] - `app` is the
 *   version pushes say they come from, which the server may refuse until the
 *   app is updated: this build's but in tests
 */
export function createApi(
  server,
  token = null,
  { fetch: send = globalThis.fetch, app = APP_VERSION } = {}
) {
  const base = serverAddress(server)

  /**
   * @param {string} method
   * @param {string} path
   * @param {{body?: unknown, signal?: AbortSignal}} [options]
   * @returns {Promise<any>}
   */
  async function call(method, path, { body, signal } = {}) {
    /** @type {Response} */
    let response
    try {
      response = await send(base + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') throw error
      throw new CloudError(`The sync server at ${base} can't be reached.`, 0)
    }
    return answer(response)
  }

  /** @param {any} listed @returns {ListedCollection} */
  const collection = listed => ({
    ...listed,
    key: fromBase64(listed.key),
    meta: listed.meta ? fromBase64(listed.meta) : null,
  })

  /**
   * Every collection, with the server's generation: new once it has been
   * put back from a backup. An older server has none.
   * @returns {Promise<{collections: ListedCollection[], generation: string|null}>}
   */
  async function listing() {
    const listed = await call('GET', '/v1/collections')
    return {
      collections: listed.collections.map(collection),
      generation: listed.generation ?? null,
    }
  }

  return {
    server: base,

    /** @param {string} name */
    prelogin: name => call('POST', '/v1/prelogin', { body: { name } }),

    /**
     * @param {{name: string, salt: Bytes, kdf: object, auth: Bytes, key: Bytes, recovery: {auth: Bytes, key: Bytes}, code: string, device: string}} account
     * @returns {Promise<{token: string}>}
     */
    signUp: ({ name, salt, kdf, auth, key, recovery, code, device }) =>
      call('POST', '/v1/accounts', {
        body: {
          name,
          salt: toBase64(salt),
          kdf,
          auth: toBase64(auth),
          key: toBase64(key),
          recovery: { auth: toBase64(recovery.auth), key: toBase64(recovery.key) },
          code,
          device,
        },
      }),

    /**
     * @param {string} name
     * @param {Bytes} auth
     * @param {string} device - What this device calls itself
     * @returns {Promise<{token: string, key: Bytes}>}
     */
    async signIn(name, auth, device) {
      const signed = await call('POST', '/v1/sessions', {
        body: { name, auth: toBase64(auth), device },
      })
      return { token: signed.token, key: fromBase64(signed.key) }
    },

    /**
     * Sign in with a recovery code's sign-in key.
     * @param {string} name
     * @param {Bytes} auth
     * @param {string} device
     * @returns {Promise<{token: string, key: Bytes}>} The account key wrapped under the code
     */
    async recover(name, auth, device) {
      const signed = await call('POST', '/v1/recovery', {
        body: { name, auth: toBase64(auth), device },
      })
      return { token: signed.token, key: fromBase64(signed.key) }
    },

    signOut: () => call('DELETE', '/v1/sessions'),

    /** @returns {Promise<AccountRecord>} */
    async account() {
      const kept = await call('GET', '/v1/account')
      return {
        ...kept,
        salt: fromBase64(kept.salt),
        key: fromBase64(kept.key),
        ...(kept.publicKey
          ? { publicKey: fromBase64(kept.publicKey), privateKey: fromBase64(kept.privateKey) }
          : {}),
      }
    },

    /**
     * Keep the account's key pair, unless it has one: what it has comes back.
     * @param {Bytes} publicKey
     * @param {Bytes} privateKey - Sealed under the account key
     * @returns {Promise<{publicKey: Bytes, privateKey: Bytes}>}
     */
    async setKeys(publicKey, privateKey) {
      const kept = await call('PUT', '/v1/account/keys', {
        body: { publicKey: toBase64(publicKey), privateKey: toBase64(privateKey) },
      })
      return { publicKey: fromBase64(kept.publicKey), privateKey: fromBase64(kept.privateKey) }
    },

    /**
     * Give the account the name the people it shares with see.
     * @param {string} display - Empty for none
     */
    setDisplay: display => call('PUT', '/v1/account/display', { body: { display } }),

    /**
     * The account a friend code is of, and its public key.
     * @param {string} code
     * @returns {Promise<{account: number, publicKey: Bytes, display: string|null}>}
     */
    async friend(code) {
      const found = await call('GET', `/v1/friends/${encodeURIComponent(code)}`)
      return { ...found, publicKey: fromBase64(found.publicKey) }
    },

    /**
     * Mark a collection shared, before its chats go again as each one's own.
     * @param {string} id
     */
    share: id => call('PUT', `/v1/collections/${id}/shared`),

    /**
     * Share a collection with only some of its documents, or all of them again.
     * @param {string} id
     * @param {boolean} selective
     */
    setSelective: (id, selective) =>
      call('PUT', `/v1/collections/${id}/selective`, { body: { selective } }),

    /**
     * Who is in a collection, the owner first.
     * @param {string} id
     * @returns {Promise<Member[]>}
     */
    async members(id) {
      return (await call('GET', `/v1/collections/${id}/members`)).members
    },

    /**
     * Add the account a friend code is of to a collection, with its key wrapped for them.
     * @param {string} id
     * @param {string} friend - The code
     * @param {Bytes} key
     * @returns {Promise<{account: number, display: string|null}>}
     */
    addMember: (id, friend, key) =>
      call('POST', `/v1/collections/${id}/members`, { body: { friend, key: toBase64(key) } }),

    /**
     * Take someone out of a collection, or this account, leaving it.
     * @param {string} id
     * @param {number} account
     */
    removeMember: (id, account) => call('DELETE', `/v1/collections/${id}/members/${account}`),

    /**
     * Keep a shared collection's key wrapped again, under this account's key.
     * @param {string} id
     * @param {Bytes} key
     */
    rewrap: (id, key) => call('PUT', `/v1/collections/${id}/key`, { body: { key: toBase64(key) } }),

    /**
     * Keep a new recovery code: its sign-in key, and the account key wrapped under it.
     * @param {Proof} proof
     * @param {{auth: Bytes, key: Bytes}} recovery
     */
    setRecovery: (proof, { auth, key }) =>
      call('PUT', '/v1/account/recovery', {
        body: { ...proofOf(proof), auth: toBase64(auth), key: toBase64(key) },
      }),

    /**
     * Keep a new passphrase: its salt and settings, its sign-in key, and the
     * account key wrapped under it.
     * @param {Proof} proof
     * @param {{salt: Bytes, kdf: object, auth: Bytes, key: Bytes}} passphrase
     */
    setPassphrase: (proof, { salt, kdf, auth, key }) =>
      call('PUT', '/v1/account/passphrase', {
        body: {
          ...proofOf(proof),
          salt: toBase64(salt),
          kdf,
          auth: toBase64(auth),
          key: toBase64(key),
        },
      }),

    /** @returns {Promise<Device[]>} */
    async devices() {
      return (await call('GET', '/v1/sessions')).sessions
    },

    /** @param {string} id - Another device's */
    signOutDevice: id => call('DELETE', `/v1/sessions/${id}`),

    /** @param {string} device - What this device calls itself */
    nameDevice: device => call('PUT', '/v1/session', { body: { device } }),

    listing,

    /** @returns {Promise<ListedCollection[]>} */
    async collections() {
      return (await listing()).collections
    },

    /**
     * Make a collection, or have the one already there.
     * @param {string} id
     * @param {Bytes} key
     * @param {Bytes|null} meta - What it is, sealed; none for the account's own
     * @returns {Promise<{made: boolean, collection: ListedCollection}>}
     */
    async putCollection(id, key, meta) {
      const put = await call('PUT', `/v1/collections/${id}`, {
        body: { key: toBase64(key), meta: meta ? toBase64(meta) : null },
      })
      return { made: put.made, collection: collection(put.collection) }
    },

    /**
     * Delete a collection: the project deleted, or kept by this device to
     * itself, which the other devices hear of as such.
     * @param {string} id
     * @param {{kept?: boolean}} [options]
     * @returns {Promise<{seq: number}>}
     */
    deleteCollection: (id, { kept = false } = {}) =>
      call('DELETE', `/v1/collections/${id}${kept ? '?kept=1' : ''}`),

    /**
     * @param {string} id
     * @param {number} schema
     * @param {Array<{name: string, base: number, body: Bytes, blob?: string|null, own?: boolean, hidden?: Bytes}>} records -
     *   `blob` is the blob a file's record names, which the server lets go
     *   of once nothing names it; `own`, a record of this account's alone;
     *   `hidden`, where one the others had is made so, the removal they get
     * @param {{shared?: boolean, selective?: boolean}} [knows] - Whether this
     *   device takes the collection to be shared, and with only some of its
     *   documents, which the server refuses a push to unless it does
     * @returns {Promise<{from: number, seq: number, results: PushResult[]}>}
     */
    async push(id, schema, records, { shared = false, selective = false } = {}) {
      const pushed = await call('POST', `/v1/collections/${id}/push`, {
        body: {
          schema,
          app,
          protocol: PROTOCOL,
          shared,
          selective,
          records: records.map(record => ({
            ...record,
            body: toBase64(record.body),
            ...(record.hidden ? { hidden: toBase64(record.hidden) } : {}),
          })),
        },
      })
      return {
        ...pushed,
        results: pushed.results.map((/** @type {any} */ result) =>
          result.conflict
            ? {
                name: result.name,
                conflict: {
                  rev: result.conflict.rev,
                  body: result.conflict.body ? fromBase64(result.conflict.body) : null,
                  own: Boolean(result.conflict.own),
                },
              }
            : result
        ),
      }
    },

    /**
     * @param {string} id
     * @param {number} since
     * @returns {Promise<{seq: number, epoch: number, more: boolean, records: PulledRecord[]}>}
     */
    async changes(id, since) {
      const changes = await call(
        'GET',
        `/v1/collections/${id}/changes?since=${since}&protocol=${PROTOCOL}`
      )
      return {
        ...changes,
        records: changes.records.map((/** @type {any} */ record) => ({
          ...record,
          body: record.body ? fromBase64(record.body) : null,
        })),
      }
    },

    /**
     * The parts of a file the server has.
     * @param {string} id
     * @param {string} blob
     * @returns {Promise<number[]>}
     */
    async parts(id, blob) {
      return (await call('GET', `/v1/collections/${id}/blobs/${blob}`)).parts
    },

    /**
     * @param {string} id
     * @param {string} blob
     * @param {number} part
     * @param {Bytes} bytes
     */
    async putPart(id, blob, part, bytes) {
      const response = await send(`${base}/v1/collections/${id}/blobs/${blob}/${part}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: bytes,
      }).catch(() => {
        throw new CloudError(`The sync server at ${base} can't be reached.`, 0)
      })
      await answer(response)
    },

    /**
     * @param {string} id
     * @param {string} blob
     * @param {number} part
     * @returns {Promise<Bytes>}
     */
    async getPart(id, blob, part) {
      const response = await send(`${base}/v1/collections/${id}/blobs/${blob}/${part}`, {
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {
        throw new CloudError(`The sync server at ${base} can't be reached.`, 0)
      })
      if (!response.ok) await answer(response)
      return new Uint8Array(await response.arrayBuffer())
    },

    /**
     * Tell the server how syncing has gone here: counts, never content.
     * Sent as the page is hidden too, so it may outlive the page.
     * @param {object} report
     */
    diagnostics: report =>
      send(`${base}/v1/diagnostics`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(report),
        keepalive: true,
      }).then(answer, () => {
        throw new CloudError(`The sync server at ${base} can't be reached.`, 0)
      }),

    /**
     * Hear of every collection that changes, until the signal says stop or
     * the stream breaks. Resolves when it ends.
     *
     * @param {(change: {collection: string, seq: number}) => void} heard
     * @param {AbortSignal} signal
     */
    async listen(heard, signal) {
      const response = await send(`${base}/v1/events`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      })
      if (!response.ok || !response.body) await answer(response)
      const reader = /** @type {ReadableStream<Bytes>} */ (response.body).getReader()
      const decoder = new TextDecoder()
      let pending = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        pending += decoder.decode(value, { stream: true })
        let end
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, end)
          pending = pending.slice(end + 2)
          const data = event
            .split('\n')
            .filter(line => line.startsWith('data: '))
            .map(line => line.slice(6))
            .join('\n')
          if (data) heard(JSON.parse(data))
        }
      }
    },
  }
}

/** @typedef {ReturnType<typeof createApi>} Api */

/**
 * What the server answered, or what it refused.
 * @param {Response} response
 */
async function answer(response) {
  /** @type {any} */
  let body = null
  try {
    body = await response.json()
  } catch {
    // An answer that isn't JSON says no more than its status.
  }
  if (response.ok) return body
  const { error, ...extra } = body ?? {}
  throw new CloudError(
    error || `The sync server answered ${response.status}.`,
    response.status,
    extra
  )
}

/**
 * A server's address as the writer typed it: https assumed when no scheme is
 * given, and no slash at the end.
 *
 * @param {string} typed
 */
function serverAddress(typed) {
  const address = typed.trim().replace(/\/+$/, '')
  return /^[a-z][\w+.-]*:\/\//i.test(address) ? address : `https://${address.replace(/^\/+/, '')}`
}

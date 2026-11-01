/**
 * Local WhatsApp gateway for the Beauty TradeOps.
 *
 * Speaks WhatsApp's multi-device protocol directly via Baileys, so the
 * shop PC needs no Docker, no container runtime and no second database —
 * this process ships inside the same install as the backend and is started
 * and supervised by it (see backend/whatsapp/sidecar.py).
 *
 * It binds to loopback only and requires a shared token on every request:
 * anything that can reach this port can send messages as the shop, so it
 * must never be exposed to the LAN.
 *
 * Responsibilities are deliberately narrow. It sends, it reports link
 * state, and it forwards delivery receipts. It does not retry, queue or
 * rate-limit — the backend's outbox owns all of that, so delivery
 * guarantees stay in one place regardless of which gateway is in use.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const express = require('express')
const pino = require('pino')
const QRCode = require('qrcode')
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')

const PORT = parseInt(process.env.WA_PORT || '8090', 10)
const TOKEN = process.env.WA_TOKEN || ''
const SESSION_DIR = process.env.WA_SESSION_DIR || path.join(__dirname, '.session')
const WEBHOOK_URL = process.env.WA_WEBHOOK_URL || ''

const log = pino({
  level: process.env.WA_LOG_LEVEL || 'warn',
  transport: undefined,
})

/**
 * Plaintext of everything we have sent, keyed by message id.
 *
 * WhatsApp messages are Signal-encrypted per session. When the recipient's
 * device cannot decrypt one — which happens routinely after a relink, or
 * when the session ratchet slips — their phone sends a *retry receipt*
 * asking us to re-encrypt and send it again. Baileys does that for us, but
 * it does not keep our plaintext: it calls `getMessage(key)` to ask for it
 * back. Without this store that callback returns nothing, the retry can
 * never be fulfilled, and the recipient sits on "Waiting for this message.
 * This may take a while" forever while the sender shows a single tick.
 *
 * Bounded, because it only has to survive the seconds-to-minutes window in
 * which a retry receipt can arrive — not the life of the process.
 */
const SENT_MESSAGES = new Map()
const SENT_MESSAGES_MAX = 1000

function rememberMessage(id, message) {
  if (!id || !message) return
  SENT_MESSAGES.set(id, message)
  // Map preserves insertion order, so the oldest key is the first one.
  while (SENT_MESSAGES.size > SENT_MESSAGES_MAX) {
    SENT_MESSAGES.delete(SENT_MESSAGES.keys().next().value)
  }
}

/** Minimal CacheStore for Baileys' retry counter (avoids a node-cache dep). */
function makeCache() {
  const store = new Map()
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    del: (key) => store.delete(key),
    flushAll: () => store.clear(),
  }
}

const retryCounterCache = makeCache()

/** Everything the HTTP layer needs to know about the live connection. */
const state = {
  sock: null,
  /** 'close' | 'connecting' | 'open' */
  connection: 'close',
  /** Data-URI QR, refreshed by Baileys every ~20s while unlinked. */
  qr: '',
  pairingCode: '',
  detail: '',
  /** Set while a deliberate unlink is in progress, to suppress reconnect. */
  loggingOut: false,
  reconnectAttempts: 0,
}

// ---------------------------------------------------------------------------
// WhatsApp connection
// ---------------------------------------------------------------------------

async function connect() {
  fs.mkdirSync(SESSION_DIR, { recursive: true })

  const { state: auth, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth,
    logger: log,
    // The shop sends notifications; it never needs to appear online or
    // read receipts of its own, and staying quiet looks less like a bot.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ['TradeOps', 'Desktop', '1.0.0'],
    // Answers the recipient's "I couldn't decrypt that, send it again"
    // retry receipts. Without it those requests go unanswered and the
    // message is stuck as undecryptable on their phone permanently.
    getMessage: async (key) => SENT_MESSAGES.get(key?.id) || undefined,
    msgRetryCounterCache: retryCounterCache,
  })

  state.sock = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // Render to a data URI so the SPA can show it directly in an <img>
      // without pulling in a QR library of its own.
      try {
        state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      } catch (err) {
        log.error({ err }, 'Could not render QR code')
      }
    }

    if (connection) {
      state.connection = connection
    }

    if (connection === 'open') {
      state.qr = ''
      state.pairingCode = ''
      state.detail = 'Linked and ready.'
      state.reconnectAttempts = 0
      log.info('WhatsApp connection open')
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut

      if (state.loggingOut || loggedOut) {
        // The phone unlinked us (or we asked to be unlinked). Reconnecting
        // is pointless until somebody links again, and the stale
        // credentials would only make the next link attempt fail.
        state.detail = loggedOut
          ? 'WhatsApp unlinked this device. Link again to resume sending.'
          : 'Unlinked.'
        state.loggingOut = false
        clearSession()
        state.connection = 'close'
        log.warn('Session ended; awaiting a new link')
        return
      }

      // Any other drop is transient (network, WhatsApp restart). Reconnect
      // with a backoff so a persistent fault doesn't spin the CPU.
      state.reconnectAttempts += 1
      const delay = Math.min(60000, 2000 * state.reconnectAttempts)
      state.detail = `Disconnected (${code || 'unknown'}); reconnecting in ${Math.round(delay / 1000)}s.`
      log.warn({ code }, 'Connection closed; reconnecting')
      setTimeout(() => connect().catch((err) => log.error({ err }, 'Reconnect failed')), delay)
    }
  })

  // Delivery receipts. This is the only way the backend can distinguish
  // "the gateway accepted it" from "the customer's phone received it".
  sock.ev.on('messages.update', (updates) => {
    for (const entry of updates) {
      const status = entry.update?.status
      const id = entry.key?.id
      if (!id || status === undefined) continue
      // WhatsApp reports status for every message on the account, including
      // ones the owner sent from their own phone. Forwarding those made the
      // backend answer "unknown message id" all day; only our own sends can
      // possibly match a queue row.
      if (!entry.key?.fromMe || !SENT_MESSAGES.has(id)) continue
      postReceipt(id, mapStatus(status))
    }
  })

  return sock
}

/** Baileys reports delivery as an enum; translate to the backend's words. */
function mapStatus(status) {
  // 2 = server ack, 3 = delivered to device, 4 = read, 5 = played
  if (status >= 5) return 'READ'
  if (status === 4) return 'READ'
  if (status === 3) return 'DELIVERED'
  if (status === 0) return 'FAILED'
  return ''
}

async function postReceipt(id, status) {
  if (!WEBHOOK_URL || !status) return
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
      body: JSON.stringify({ id, status }),
    })
  } catch (err) {
    // A receipt that cannot be delivered is not worth failing over: the
    // message itself already went out, and the backend will simply keep
    // showing it as SENT rather than DELIVERED.
    log.warn({ err: err.message }, 'Could not post delivery receipt')
  }
}

function clearSession() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
    fs.mkdirSync(SESSION_DIR, { recursive: true })
  } catch (err) {
    log.error({ err }, 'Could not clear session directory')
  }
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const app = express()
app.use(express.json({ limit: '1mb' }))

app.use((req, res, next) => {
  if (!TOKEN) {
    return res.status(500).json({ error: 'no_token', detail: 'WA_TOKEN is not configured.' })
  }
  if (req.headers['x-auth-token'] !== TOKEN) {
    return res.status(403).json({ error: 'forbidden', detail: 'Invalid token.' })
  }
  next()
})

// Groups the linked phone is a member of (to pick where reports go).
app.get('/groups', async (req, res) => {
  if (state.connection !== 'open' || !state.sock) {
    return res.status(503).json({ error: 'not_connected', detail: state.detail || 'WhatsApp is not linked.' })
  }
  try {
    const groups = await state.sock.groupFetchAllParticipating()
    const list = Object.values(groups || {})
      .map((g) => ({ id: g.id, subject: g.subject || '', size: (g.participants || []).length }))
      .sort((a, b) => a.subject.localeCompare(b.subject))
    return res.json({ groups: list })
  } catch (err) {
    return res.status(502).json({ error: 'groups_failed', detail: err.message })
  }
})

// Send to a group by its id (…@g.us). Members' numbers are not checked one by one.
app.post('/send-group', async (req, res) => {
  const jid = String(req.body?.jid || '')
  const text = String(req.body?.text || '')
  if (!/^[\d-]+@g\.us$/.test(jid) || !text.trim()) {
    return res.status(400).json({ error: 'bad_request', detail: 'jid (…@g.us) and text are required.' })
  }
  if (state.connection !== 'open' || !state.sock) {
    return res.status(503).json({ error: 'not_connected', detail: state.detail || 'WhatsApp is not linked.' })
  }
  try {
    const sent = await state.sock.sendMessage(jid, { text })
    rememberMessage(sent?.key?.id, sent?.message)
    return res.json({ id: sent?.key?.id || '', detail: 'Sent.' })
  } catch (err) {
    return res.status(502).json({ error: 'send_failed', detail: err.message })
  }
})

app.get('/status', (req, res) => {
  res.json({
    state: state.connection,
    detail: state.detail,
    qr: state.qr,
    pairingCode: state.pairingCode,
  })
})

app.post('/link', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '')

  if (state.connection === 'open') {
    return res.json({
      state: 'open',
      detail: 'Already linked. Unlink first to connect a different number.',
    })
  }

  // A pairing code can only be requested on a socket that has no
  // credentials yet, so make sure one is running and unregistered.
  if (!state.sock || state.connection === 'close') {
    try {
      await connect()
    } catch (err) {
      return res.status(502).json({ error: 'connect_failed', detail: err.message })
    }
  }

  if (!phone) {
    // QR route: wait briefly for Baileys to emit the first code rather
    // than returning an empty frame the UI would have to poll for.
    const qr = await waitFor(() => state.qr, 15000)
    if (!qr) {
      return res.status(502).json({ error: 'no_qr', detail: 'WhatsApp did not return a QR code.' })
    }
    return res.json({ state: 'connecting', qr, detail: 'Scan this code in WhatsApp → Linked devices.' })
  }

  try {
    if (state.sock?.authState?.creds?.registered) {
      return res.status(400).json({
        error: 'already_registered',
        detail: 'This device is already registered. Unlink first.',
      })
    }
    const code = await state.sock.requestPairingCode(phone)
    state.pairingCode = code
    return res.json({
      state: 'connecting',
      pairingCode: code,
      detail: 'Enter this code in WhatsApp → Linked devices → Link with phone number.',
    })
  } catch (err) {
    return res.status(502).json({ error: 'pairing_failed', detail: err.message })
  }
})

app.post('/logout', async (req, res) => {
  state.loggingOut = true
  try {
    if (state.sock) await state.sock.logout()
  } catch (err) {
    // Logging out of an already-dead session throws; the session files are
    // cleared either way, which is what actually matters.
    log.warn({ err: err.message }, 'Logout call failed; clearing session anyway')
  }
  clearSession()
  state.connection = 'close'
  state.qr = ''
  state.pairingCode = ''
  state.detail = 'Unlinked.'
  res.json({ detail: 'Session unlinked.' })
  // Come back up unlinked so the next link attempt has a live socket.
  setTimeout(() => connect().catch((err) => log.error({ err }, 'Reconnect after logout failed')), 1500)
})

app.post('/send', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '')
  const text = String(req.body?.text || '')

  if (!phone || !text.trim()) {
    return res.status(400).json({ error: 'bad_request', detail: 'phone and text are required.' })
  }

  // Non-Latin text has to survive Django -> HTTP -> here byte-for-byte, and
  // a mangled body still encrypts and sends happily — it just arrives as
  // something the recipient's client may not render. Log the shape (never
  // the content) so a corrupted round-trip is visible without putting
  // customer messages in the log.
  const nonAscii = [...text].filter((c) => c.codePointAt(0) > 127).length
  if (nonAscii) {
    console.log(
      `send: ${[...text].length} chars, ${nonAscii} non-ASCII, ` +
        `${Buffer.byteLength(text, 'utf8')} utf8 bytes, ` +
        `first non-ASCII U+${[...text]
          .find((c) => c.codePointAt(0) > 127)
          .codePointAt(0)
          .toString(16)
          .toUpperCase()}`,
    )
  }
  if (state.connection !== 'open' || !state.sock) {
    return res.status(503).json({
      error: 'not_connected',
      detail: state.detail || 'WhatsApp is not linked.',
    })
  }

  const jid = `${phone}@s.whatsapp.net`

  try {
    // Confirm the number actually has WhatsApp. Skipping this is how
    // messages to landlines and typo'd numbers vanish silently: Baileys
    // accepts them, and nothing ever comes back to say otherwise.
    const [check] = await state.sock.onWhatsApp(jid)
    if (!check?.exists) {
      return res.status(400).json({
        error: 'not_on_whatsapp',
        detail: `${phone} is not registered on WhatsApp.`,
      })
    }

    const sent = await state.sock.sendMessage(check.jid, { text })
    // Keep the plaintext so a retry receipt can be answered (see getMessage).
    rememberMessage(sent?.key?.id, sent?.message)
    return res.json({ id: sent?.key?.id || '', detail: 'Sent.' })
  } catch (err) {
    return res.status(502).json({ error: 'send_failed', detail: err.message })
  }
})

/** Poll `read` until it returns something truthy, or `timeout` elapses. */
function waitFor(read, timeout) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const value = read()
      if (value) return resolve(value)
      if (Date.now() - started >= timeout) return resolve(null)
      setTimeout(tick, 250)
    }
    tick()
  })
}

// Bind to loopback only — this service can send as the shop, so it must
// never be reachable from the LAN the receptionist PC sits on.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`WhatsApp service listening on 127.0.0.1:${PORT}`)
  connect().catch((err) => console.error('Initial connect failed:', err.message))
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

// Baileys does a lot of work in event handlers and background tasks, and a
// single rejected promise in there is enough for Node to kill the process —
// which is what "it worked twice then stopped" looked like from the desk.
// A decryption hiccup on one message must not take the gateway down, so
// these are logged loudly and swallowed. The supervisor still restarts the
// process for anything that genuinely cannot be recovered from.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (continuing):', reason?.stack || reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (continuing):', err?.stack || err)
})

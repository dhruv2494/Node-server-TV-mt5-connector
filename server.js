require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')

const app = express()
app.use(express.json())

const PORT             = process.env.PORT         || 3000
const SECRET_TOKEN     = process.env.SECRET_TOKEN
const SIGNAL_EXPIRY_MS = 120000  // 2 minutes
const GROUP_WINDOW_MS  = 500     // 500ms grouping window
const QUEUE_FILE       = path.join(__dirname, 'queue.json')

// Signal queue
let signalQueue     = []
let processingTimer = null

// ─── Load queue from disk on startup ───
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'))
      const now  = Date.now()
      signalQueue = data.filter(s => {
        const age = now - new Date(s.timestamp).getTime()
        return age < SIGNAL_EXPIRY_MS
      })
      console.log(`[Queue] Loaded ${signalQueue.length} valid signal(s) from disk`)
    }
  } catch(e) {
    console.error('[Queue] Load failed:', e.message)
    signalQueue = []
  }
}

// ─── Save queue to disk ───
function saveQueue() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(signalQueue))
  } catch(e) {
    console.error('[Queue] Save failed:', e.message)
  }
}

// ─── Sort queue — CLOSE always before BUY/SELL ───
function sortAndLockQueue() {
  signalQueue.sort((a, b) => {
    const priority = { 'CLOSE': 0, 'BUY': 1, 'SELL': 1 }
    return priority[a.action] - priority[b.action]
  })
  saveQueue()
  console.log(`[Queue] Locked: ${JSON.stringify(signalQueue.map(s => s.action))}`)
}

// Load queue on startup
loadQueue()

// ─── Health check ───
app.get('/', (req, res) => {
  res.json({
    status  : 'TV-MT5 Bridge v2.0 ✅',
    queue   : signalQueue,
    pending : processingTimer ? 'grouping...' : 'ready',
    uptime  : Math.floor(process.uptime()) + 's',
    time    : new Date().toISOString()
  })
})

// ─── TradingView webhook ───
app.post('/webhook', (req, res) => {

  // Validate token
  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    console.warn('[Webhook] Unauthorized blocked')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { action, symbol, volume } = req.body

  // Validate fields
  if (!action || !symbol) {
    return res.status(400).json({ error: 'Missing action or symbol' })
  }

  const validActions = ['BUY', 'SELL', 'CLOSE']
  if (!validActions.includes(action.toUpperCase())) {
    return res.status(400).json({ error: 'Invalid action. Must be BUY SELL or CLOSE' })
  }

  const signal = {
    action   : action.toUpperCase(),
    symbol   : symbol.toUpperCase(),
    volume   : parseFloat(volume) || 0.01,
    timestamp: new Date().toISOString(),
    received : Date.now()
  }

  const act = signal.action

  // Queue logic
  if (act === 'BUY' || act === 'SELL') {
    // Remove any previous BUY/SELL — keep only latest entry signal
    signalQueue = signalQueue.filter(s => s.action === 'CLOSE')
    signalQueue.push(signal)
  } else if (act === 'CLOSE') {
    signalQueue.push(signal)
  }

  console.log(`[Webhook] ${act} received | Queue: ${JSON.stringify(signalQueue.map(s => s.action))}`)

  // Reset grouping timer — wait 500ms for more signals from same bar
  if (processingTimer) clearTimeout(processingTimer)
  processingTimer = setTimeout(() => {
    sortAndLockQueue()
    processingTimer = null
  }, GROUP_WINDOW_MS)

  return res.status(200).json({ success: true, queued: act })
})

// ─── MT5 EA polls every 2 seconds ───
app.get('/signal', (req, res) => {

  // Validate token
  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Wait if still grouping signals from same bar
  if (processingTimer) {
    return res.status(200).json({ action: 'NONE' })
  }

  // Remove expired signals
  const now    = Date.now()
  const before = signalQueue.length
  signalQueue  = signalQueue.filter(s => {
    const age = now - new Date(s.timestamp).getTime()
    if (age > SIGNAL_EXPIRY_MS) {
      console.warn(`[Signal] DISCARDED stale ${s.action} (${Math.round(age/1000)}s old)`)
      return false
    }
    return true
  })
  if (before !== signalQueue.length) saveQueue()

  // No signals
  if (signalQueue.length === 0) {
    return res.status(200).json({ action: 'NONE' })
  }

  // Serve next signal in queue
  const signal = signalQueue.shift()
  saveQueue()
  console.log(`[Signal] → MT5: ${signal.action} ${signal.symbol} | Remaining: ${signalQueue.length}`)
  return res.status(200).json(signal)
})

// ─── MT5 confirms execution ───
app.post('/confirm', (req, res) => {

  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { status, action, symbol, message } = req.body
  console.log(`[Confirm] ${status} | ${action} | ${symbol} | ${message} | Queue:${signalQueue.length}`)
  return res.status(200).json({ received: true })
})

// ─── Emergency clear queue ───
app.post('/clear', (req, res) => {

  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (processingTimer) clearTimeout(processingTimer)
  processingTimer = null
  const cleared = [...signalQueue]
  signalQueue   = []
  saveQueue()
  console.log(`[Clear] Queue cleared: ${JSON.stringify(cleared.map(s => s.action))}`)
  return res.status(200).json({ cleared })
})

app.listen(PORT, () => {
  console.log(`[Server] TV-MT5 Bridge v2.0 running on port ${PORT}`)
})
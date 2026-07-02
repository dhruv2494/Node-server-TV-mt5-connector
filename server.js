require('dotenv').config()
const express = require('express')

const app = express()
app.use(express.json())

const PORT         = process.env.PORT         || 3000
const SECRET_TOKEN = process.env.SECRET_TOKEN
const SIGNAL_EXPIRY_MS = 120000 // 2 minutes — stale signal discard

// Signal queue — only ONE pending signal at a time
let pendingSignal = null

// Health check
app.get('/', (req, res) => {
  res.json({
    status  : 'TV-MT5 Bridge running ✅',
    pending : pendingSignal,
    time    : new Date().toISOString()
  })
})

// TradingView webhook — receives BUY or SELL signal
app.post('/webhook', (req, res) => {

  // Validate token
  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    console.warn('[Webhook] Unauthorized blocked')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { action, symbol, volume } = req.body

  // Validate required fields
  if (!action || !symbol) {
    return res.status(400).json({ error: 'Missing action or symbol' })
  }

  const validActions = ['BUY', 'SELL']
  if (!validActions.includes(action.toUpperCase())) {
    return res.status(400).json({ error: 'Invalid action. Must be BUY or SELL' })
  }

  // Store signal — overwrite any previous pending
  pendingSignal = {
    action   : action.toUpperCase(),
    symbol   : symbol.toUpperCase(),
    volume   : parseFloat(volume) || 0.01,
    timestamp: new Date().toISOString()
  }

  console.log(`[Webhook] Signal stored → ${pendingSignal.action} ${pendingSignal.symbol} vol:${pendingSignal.volume} at ${pendingSignal.timestamp}`)
  return res.status(200).json({ success: true, signal: pendingSignal })
})

// MT5 EA polls this every 2 seconds
app.get('/signal', (req, res) => {

  // Validate token
  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!pendingSignal) {
    return res.status(200).json({ action: 'NONE' })
  }

  // Discard stale signal older than 2 minutes
  const signalAge = Date.now() - new Date(pendingSignal.timestamp).getTime()
  if (signalAge > SIGNAL_EXPIRY_MS) {
    console.warn(`[Signal] DISCARDED — stale signal ${Math.round(signalAge / 1000)}s old → ${pendingSignal.action}`)
    pendingSignal = null
    return res.status(200).json({ action: 'NONE' })
  }

  const signal  = pendingSignal
  pendingSignal = null
  console.log(`[Signal] Sent to MT5 → ${signal.action} ${signal.symbol} (age: ${Math.round(signalAge / 1000)}s)`)
  return res.status(200).json(signal)
})

// MT5 EA confirms execution result
app.post('/confirm', (req, res) => {

  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { status, action, symbol, message } = req.body
  console.log(`[Confirm] MT5 → Status:${status} | Action:${action} | Symbol:${symbol} | Msg:${message}`)
  return res.status(200).json({ received: true })
})

app.listen(PORT, () => {
  console.log(`[Server] Webhook server running on port ${PORT}`)
})
require('dotenv').config()
const express = require('express')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const SECRET_TOKEN = process.env.SECRET_TOKEN

// Signal queue — only ONE pending signal at a time
let pendingSignal = null

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'TV-MT5 Bridge running ✅', pending: pendingSignal })
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
    action: action.toUpperCase(),
    symbol: symbol.toUpperCase(),
    volume: parseFloat(volume) || 0.01,
    timestamp: new Date().toISOString()
  }

  console.log(`[Webhook] Signal stored → ${pendingSignal.action} ${pendingSignal.symbol} vol:${pendingSignal.volume}`)
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

  // Return signal and clear queue
  const signal = pendingSignal
  pendingSignal = null
  console.log(`[Signal] Sent to MT5 → ${signal.action} ${signal.symbol}`)
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
require('dotenv').config()
const express = require('express')
const { sendToMT5 } = require('./mt5Bridge')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const SECRET_TOKEN = process.env.SECRET_TOKEN

// Health check route
app.get('/', (req, res) => {
  res.send('TradingView → MT5 Bridge is running ✅')
})

// Webhook route
app.post('/webhook', async (req, res) => {

  // 1. Validate secret token
  const token = req.query.token || req.headers['x-token']
  if (token !== SECRET_TOKEN) {
    console.warn('[Webhook] Unauthorized request blocked')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 2. Parse payload from TradingView
  const { action, symbol, volume } = req.body

  if (!action || !symbol) {
    return res.status(400).json({ error: 'Missing action or symbol' })
  }

  console.log(`[Webhook] Signal received → Action: ${action} | Symbol: ${symbol} | Volume: ${volume}`)

  // 3. Build MT5 command
  const payload = {
    action: action.toUpperCase(), // BUY or SELL
    symbol: symbol,               // XAUUSD
    volume: volume || 0.01        // default 0.01 lot
  }

  // 4. Send to MT5 EA via TCP socket
  try {
    const response = await sendToMT5(payload)
    console.log(`[Webhook] MT5 responded: ${response}`)
    return res.status(200).json({ success: true, mt5Response: response })
  } catch (err) {
    console.error(`[Webhook] Failed to send to MT5: ${err.message}`)
    return res.status(500).json({ error: 'Failed to reach MT5 EA' })
  }

})

app.listen(PORT, () => {
  console.log(`[Server] Webhook server running on port ${PORT}`)
})
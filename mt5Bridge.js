const net = require('net')
require('dotenv').config()

const MT5_HOST = process.env.MT5_HOST || '127.0.0.1'
const MT5_PORT = process.env.MT5_PORT || 9999

function sendToMT5(payload) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket()

    client.connect(MT5_PORT, MT5_HOST, () => {
      console.log(`[MT5 Bridge] Connected to MT5 EA`)
      const message = JSON.stringify(payload) + '\n'
      client.write(message)
    })

    client.on('data', (data) => {
      console.log(`[MT5 Bridge] Response from EA: ${data.toString()}`)
      resolve(data.toString())
      client.destroy()
    })

    client.on('error', (err) => {
      console.error(`[MT5 Bridge] Connection error: ${err.message}`)
      reject(err)
      client.destroy()
    })

    client.on('timeout', () => {
      console.error(`[MT5 Bridge] Connection timeout`)
      reject(new Error('MT5 connection timeout'))
      client.destroy()
    })

    client.setTimeout(5000)
  })
}

module.exports = { sendToMT5 }
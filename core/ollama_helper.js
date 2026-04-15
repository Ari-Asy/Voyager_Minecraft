const http = require('http')

function ollamaGenerate(endpoint, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${endpoint}/api/generate`)
        const data = JSON.stringify({ ...body, stream: false, keep_alive: 0 })

        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let fullBody = ''
            res.setEncoding('utf8')
            res.on('data', chunk => fullBody += chunk)
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`Ollama HTTP ${res.statusCode}`))
                try {
                    const json = JSON.parse(fullBody)
                    resolve(json.response || '')
                } catch (e) {
                    resolve(fullBody)
                }
            })
        })

        req.on('error', reject)
        req.write(data)
        req.end()
    })
}

module.exports = { ollamaGenerate }
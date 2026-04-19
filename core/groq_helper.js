const config = require('../config')

let _groqClient = null

function getClient() {
    if (!_groqClient) {
        const Groq = require('groq-sdk')
        _groqClient = new Groq({ apiKey: config.groq.apiKey })
    }
    return _groqClient
}

async function groqGenerate(prompt, systemPrompt, format) {
    const client = getClient()
    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const completion = await client.chat.completions.create({
        model: config.groq.model,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        response_format: format === 'json' ? { type: 'json_object' } : undefined
    })

    return completion.choices[0]?.message?.content || ''
}

module.exports = { groqGenerate }
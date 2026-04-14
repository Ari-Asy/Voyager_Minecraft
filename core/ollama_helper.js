/**
 * Helper: call Ollama with streaming to avoid buffering huge JSON blobs in heap.
 * stream:false makes Ollama return ONE giant JSON blob (can be 50-200MB).
 * stream:true sends small chunks that get GC'd immediately.
 */
async function ollamaGenerate(endpoint, body) {
    const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: false, keep_alive: 0 })
    })
    
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)

    const json = await res.json()
    return json.response || ''
}

module.exports = { ollamaGenerate }
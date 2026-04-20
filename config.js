module.exports = {
  bot1: {
    host: '10.2.149.205',
    port: 25565,
    username: 'NPC_Ollama'
  },
  bot2: {
    host: '10.2.149.205',
    port: 25565,
    username: 'NPC_Groq'
  },
  loops: {
    heartbeatMs: 400,
    thinkMs: 8000,
    saveMs: 30000
  },
  ollama: {
    enabled: true,
    endpoint: 'http://127.0.0.1:11434',
    planModel: 'gemma3:4b',          // lightweight for quick planning
    codeModel: 'gemma3:4b',   // for JS code generation (skill discovery)
    embedModel: 'nomic-embed-text',    // for vector similarity search
    useEmbeddings: false
  },
  groq: {
    enabled: true,
    apiKey: 'API_KEY_GROQ', // ใส่ API Key ของ Groq ตรงนี้
    model: 'llama-3.1-8b-instant', // หรือ 'llama-3.3-70b-versatile' ถ้าอยากได้ตัวใหญ่
  },
  thresholds: {
    lowHealth: 8,
    lowFood: 10,
    emergencyFood: 6
  },
  skill: {
    maxRetries: 4,            // max retries per task (iterative prompting)
    retrievalTopK: 5,         // how many skills to retrieve for context
    minSuccessToSave: 1       // minimum successes before saving to library
  },
  curriculum: {
    maxIterations: 160,       // max learning iterations
    enabled: true
  },
  experience: {
    maxEntries: 500,          // max experience entries to keep
    summaryCount: 10          // how many recent experiences to summarize for LLM
  }
}
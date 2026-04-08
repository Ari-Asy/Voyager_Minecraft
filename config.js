module.exports = {
  mc: {
    host: '127.0.0.1',
    port: 25565,
    username: 'NPC_AI'
  },
  loops: {
    heartbeatMs: 400,
    thinkMs: 2500,
    saveMs: 5000
  },
  ollama: {
    enabled: true,
    endpoint: 'http://127.0.0.1:11434/api/generate',
    model: 'gemma3:4b'
  },
  thresholds: {
    lowHealth: 8,
    lowFood: 10,
    emergencyFood: 6
  }
}
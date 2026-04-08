const fs = require('fs')
const path = require('path')

const stateDir = path.join(__dirname, '..', 'state')
const memoryFile = path.join(stateDir, 'memory.json')

function ensureState() {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })

  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, JSON.stringify({
      home: null,
      lastDeath: null,
      projects: [
        { name: 'survive', status: 'active' },
        { name: 'get_food', status: 'pending' },
        { name: 'get_wood', status: 'pending' },
        { name: 'craft_basics', status: 'pending' },
        { name: 'establish_base', status: 'pending' }
      ],
      knownTrees: [],
      knownFoodSpots: [],
      journal: []
    }, null, 2))
  }
}

function loadMemory() {
  ensureState()
  return JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
}

function saveMemory(memory) {
  const safe = JSON.parse(JSON.stringify(memory))
  delete safe.movements
  delete safe.runtime
  fs.writeFileSync(memoryFile, JSON.stringify(safe, null, 2))
}

function journal(memory, msg) {
  if (!Array.isArray(memory.journal)) memory.journal = []
  memory.journal.push(`[${new Date().toISOString()}] ${msg}`)
  if (memory.journal.length > 100) memory.journal = memory.journal.slice(-100)
}

module.exports = { loadMemory, saveMemory, journal }
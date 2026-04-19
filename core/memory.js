const fs = require('fs')
const path = require('path')

const stateDir = path.join(__dirname, '..', 'state')

const DEFAULT_MEMORY = {
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
  journal: [],
  experience: [],
  completedTasks: [],
  failedTasks: [],
  currentTask: null,
  skillCount: 0
}

function ensureState(filename) {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
  const memFile = path.join(stateDir, filename)
  if (!fs.existsSync(memFile)) {
    fs.writeFileSync(memFile, JSON.stringify(DEFAULT_MEMORY, null, 2))
  }
}

function loadMemory(filename = 'memory.json') {
  ensureState(filename)
  const memFile = path.join(stateDir, filename)
  const mem = JSON.parse(fs.readFileSync(memFile, 'utf8'))
  if (!Array.isArray(mem.experience)) mem.experience = []
  if (!Array.isArray(mem.completedTasks)) mem.completedTasks = []
  if (!Array.isArray(mem.failedTasks)) mem.failedTasks = []
  if (mem.currentTask === undefined) mem.currentTask = null
  if (mem.skillCount === undefined) mem.skillCount = 0
  mem._filename = filename  // จำชื่อไฟล์ไว้สำหรับ save
  return mem
}

function sanitize(obj, seen = new Set()) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return obj.toString()
  if (typeof obj !== 'object') return obj
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  if (Array.isArray(obj)) {
    const result = obj.map(v => sanitize(v, seen))
    seen.delete(obj)
    return result
  }
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    try { result[k] = sanitize(v, seen) }
    catch { result[k] = '[Unserializable]' }
  }
  seen.delete(obj)
  return result
}

function saveMemory(memory) {
  const filename = memory._filename || 'memory.json'
  const safe = sanitize(memory)
  delete safe.movements
  delete safe.runtime
  delete safe._filename
  fs.writeFileSync(path.join(stateDir, filename), JSON.stringify(safe, null, 2))
}

function journal(memory, msg) {
  if (!Array.isArray(memory.journal)) memory.journal = []
  memory.journal.push(`[${new Date().toISOString()}] ${msg}`)
  if (memory.journal.length > 100) memory.journal = memory.journal.slice(-100)
}

module.exports = { loadMemory, saveMemory, journal }
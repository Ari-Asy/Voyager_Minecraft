const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const config = require('./config')
const { loadMemory } = require('./core/memory')
const { startLoops } = require('./core/loop')
const { setupChatListener } = require('./core/chatProtocol')

const bot = mineflayer.createBot({
  host: config.bot1.host,
  port: config.bot1.port,
  username: config.bot1.username,
  viewDistance: 'tiny' // 👈 สำคัญที่สุด เรคเควสขอโหลดแค่ 2 chunk รอบตัวก็พอ!
})

bot.loadPlugin(pathfinder)

const memory = loadMemory()

bot.once('spawn', () => {
  console.log('🤖 NPC online')
  memory.movements = new Movements(bot)
  bot.pathfinder.setMovements(memory.movements)

  memory.runtime = {
    busy: false,
    currentAction: null,
    currentPlan: null,
    lastThink: 0,
    alive: true,
    targetLockUntil: 0,
    learningActive: false
  }
  memory._botName = 'bot1'

  // Phase 3: Setup chat protocol for skill sharing with Bot2
  setupChatListener(bot, memory, 'bot1')

  startLoops(bot, memory)
})

bot.on('death', () => {
  console.log('💀 died')
  memory.lastDeath = {
    time: Date.now(),
    x: Math.floor(bot.entity.position.x),
    y: Math.floor(bot.entity.position.y),
    z: Math.floor(bot.entity.position.z)
  }
  if (memory.runtime) {
    memory.runtime.busy = false
    memory.runtime.currentAction = 'recover'
    memory.runtime.currentPlan = null
    memory.runtime.alive = false
  }
})

bot.on('respawn', () => {
  console.log('✅ respawned')
  if (memory.movements) bot.pathfinder.setMovements(memory.movements)
  if (memory.runtime) {
    memory.runtime.busy = false
    memory.runtime.currentAction = 'recover'
    memory.runtime.currentPlan = null
    memory.runtime.alive = true
  }
})

bot.on('kicked', (reason) => console.log('KICKED:', reason))
bot.on('end', (reason) => console.log('END:', reason))
bot.on('error', (err) => console.log('ERROR:', err.message || err))
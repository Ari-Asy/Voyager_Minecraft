const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const config = require('./config')
const { loadMemory } = require('./core/memory')
const { startLoops } = require('./core/loop')

const bot = mineflayer.createBot({
  host: config.mc.host,
  port: config.mc.port,
  username: config.mc.username
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
    targetLockUntil: 0
  }

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
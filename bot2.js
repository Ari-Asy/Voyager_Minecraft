const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const config = require('./config')
const { loadMemory } = require('./core/memory')
const { startLoops } = require('./core/loop')
const { setupChatListener } = require('./core/chatProtocol')

const bot = mineflayer.createBot({
    host: config.bot2.host,
    port: config.bot2.port,
    username: config.bot2.username,
    viewDistance: 'tiny'
})

bot.loadPlugin(pathfinder)

const memory = loadMemory('memory_bot2.json')
memory._botName = 'bot2'

bot.once('spawn', () => {
    console.log('🤖 Bot2 (Groq) online')
    memory.movements = new Movements(bot)
    bot.pathfinder.setMovements(memory.movements)
    memory.runtime = {
        busy: false, currentAction: null, currentPlan: null,
        lastThink: 0, alive: true, targetLockUntil: 0, learningActive: false
    }

    // Phase 3: Setup chat protocol for skill sharing with Bot1
    setupChatListener(bot, memory, 'bot2')

    startLoops(bot, memory, 'groq')
})

bot.on('death', () => {
    console.log('💀 Bot2 died')
    if (memory.runtime) {
        memory.runtime.busy = false
        memory.runtime.currentAction = 'recover'
        memory.runtime.alive = false
    }
})
bot.on('respawn', () => {
    console.log('✅ Bot2 respawned')
    if (memory.movements) bot.pathfinder.setMovements(memory.movements)
    if (memory.runtime) {
        memory.runtime.busy = false
        memory.runtime.alive = true
    }
})
bot.on('kicked', r => console.log('Bot2 KICKED:', r))
bot.on('error', e => console.log('Bot2 ERROR:', e.message || e))
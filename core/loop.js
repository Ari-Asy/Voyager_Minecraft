const config = require('../config')
const { perceive } = require('./perception')
const { decide } = require('./brain')
const { execute } = require('./executor')
const { saveMemory } = require('./memory')

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function heartbeat(bot, memory) {
  while (true) {
    try {
      const state = perceive(bot, memory)

      if (state.hostile || state.health <= config.thresholds.lowHealth) {
        memory.runtime.currentPlan = { action: 'panic', reason: 'heartbeat emergency' }
      } else if (state.food <= config.thresholds.emergencyFood && state.edibleFood) {
        memory.runtime.currentPlan = { action: 'eat_food', reason: 'heartbeat emergency eat' }
      }
    } catch (e) {
      console.log('heartbeat error:', e.message || e)
    }
    await sleep(config.loops.heartbeatMs)
  }
}

async function thinkLoop(bot, memory) {
  while (true) {
    try {
      const state = perceive(bot, memory)
      const plan = memory.runtime.currentPlan?.action === 'panic'
        ? memory.runtime.currentPlan
        : await decide(state, memory)

      console.log('STATE:', {
        health: state.health,
        food: state.food,
        isNight: state.isNight,
        logCount: state.logCount,
        plankCount: state.plankCount,
        edibleFood: state.edibleFood,
        hostile: state.hostile?.name || null,
        tree: state.tree?.name || null,
        foodMob: state.foodMob?.name || null
      })

      console.log('PLAN:', plan)

      await execute(bot, memory, plan)
      memory.runtime.lastThink = Date.now()
    } catch (e) {
      console.log('think error:', e.message || e)
    }
    await sleep(config.loops.thinkMs)
  }
}

async function saveLoop(memory) {
  while (true) {
    try {
      saveMemory(memory)
    } catch (e) {
      console.log('save error:', e.message || e)
    }
    await sleep(config.loops.saveMs)
  }
}

function startLoops(bot, memory) {
  heartbeat(bot, memory)
  thinkLoop(bot, memory)
  saveLoop(memory)
}

module.exports = { startLoops }
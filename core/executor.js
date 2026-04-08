const { roam } = require('../skills/roam')
const { gatherWood } = require('../skills/gatherWood')
const { gatherFood } = require('../skills/gatherFood')
const { eatFood } = require('../skills/eatFood')
const { craftBasic } = require('../skills/craftBasic')
const { flee } = require('../skills/flee')
const { hide } = require('../skills/hide')
const { journal } = require('./memory')

async function execute(bot, memory, plan) {
  if (memory.runtime.busy) return
  memory.runtime.busy = true
  memory.runtime.currentPlan = plan

  try {
    const action = plan?.action || 'roam'
    journal(memory, `action=${action} reason=${plan?.reason || ''}`)

    if (action === 'panic') {
      memory.runtime.targetLockUntil = Date.now() + 2500
      await flee(bot, memory)
      return
    }

    if (action === 'eat_food') {
      memory.runtime.targetLockUntil = Date.now() + 1500
      await eatFood(bot, memory)
      return
    }

    if (action === 'gather_food') {
      memory.runtime.targetLockUntil = Date.now() + 6000
      await gatherFood(bot, memory)
      return
    }

    if (action === 'gather_wood') {
      memory.runtime.targetLockUntil = Date.now() + 6000
      await gatherWood(bot, memory)
      return
    }

    if (action === 'craft_basic') {
      memory.runtime.targetLockUntil = Date.now() + 2000
      await craftBasic(bot, memory)
      return
    }

    if (action === 'hide') {
      memory.runtime.targetLockUntil = Date.now() + 3000
      await hide(bot, memory)
      return
    }

    memory.runtime.targetLockUntil = Date.now() + 2500
    await roam(bot, memory)
  } finally {
    memory.runtime.busy = false
  }
}

module.exports = { execute }
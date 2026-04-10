const { roam } = require('../skills/roam')
const { gatherWood } = require('../skills/gatherWood')
const { gatherFood } = require('../skills/gatherFood')
const { eatFood } = require('../skills/eatFood')
const { craftBasic } = require('../skills/craftBasic')
const { flee } = require('../skills/flee')
const { hide } = require('../skills/hide')
const { journal } = require('./memory')
const { createSnapshot, recordExperience } = require('./experience')
const { verifyAction } = require('./critic')

/**
 * Execute a planned action with experience tracking.
 * Records before/after snapshots to learn from outcomes.
 */
async function execute(bot, memory, plan) {
  if (memory.runtime.busy) return
  memory.runtime.busy = true
  memory.runtime.currentPlan = plan

  // Take snapshot BEFORE execution
  const beforeSnap = createSnapshot(bot)
  beforeSnap._timestamp = Date.now()

  let actionError = null

  try {
    const action = plan?.action || 'roam'
    journal(memory, `action=${action} reason=${plan?.reason || ''}`)

    if (action === 'panic') {
      memory.runtime.targetLockUntil = Date.now() + 2500
      await flee(bot, memory)
    } else if (action === 'eat_food') {
      memory.runtime.targetLockUntil = Date.now() + 1500
      await eatFood(bot, memory)
    } else if (action === 'gather_food') {
      memory.runtime.targetLockUntil = Date.now() + 6000
      await gatherFood(bot, memory)
    } else if (action === 'gather_wood') {
      memory.runtime.targetLockUntil = Date.now() + 6000
      await gatherWood(bot, memory)
    } else if (action === 'craft_basic') {
      memory.runtime.targetLockUntil = Date.now() + 2000
      await craftBasic(bot, memory)
    } else if (action === 'hide') {
      memory.runtime.targetLockUntil = Date.now() + 3000
      await hide(bot, memory)
    } else {
      memory.runtime.targetLockUntil = Date.now() + 2500
      await roam(bot, memory)
    }
  } catch (e) {
    actionError = e.message || String(e)
    console.log(`execute error: ${actionError}`)
  } finally {
    // Take snapshot AFTER execution
    const afterSnap = createSnapshot(bot)
    const action = plan?.action || 'roam'

    // Verify with critic
    const verification = await verifyAction(action, plan?.task || action, beforeSnap, afterSnap, true)

    // Record experience
    recordExperience(
      memory,
      action,
      memory.currentTask || action,
      beforeSnap,
      afterSnap,
      verification.success && !actionError,
      actionError || verification.critique
    )

    memory.runtime.busy = false
  }
}

module.exports = { execute }
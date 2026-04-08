const { goals } = require('mineflayer-pathfinder')
const { GoalFollow } = goals
const { journal } = require('../core/memory')

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function nearestFoodMob(bot, maxDistance = 24) {
  const names = new Set(['cow', 'pig', 'chicken', 'sheep'])
  let best = null
  for (const e of Object.values(bot.entities)) {
    if (!e?.name || !names.has(e.name)) continue
    const d = bot.entity.position.distanceTo(e.position)
    if (d > maxDistance) continue
    if (!best || d < best.d) best = { e, d }
  }
  return best?.e || null
}

async function gatherFood(bot, memory) {
  const target = nearestFoodMob(bot)
  if (!target) {
    console.log('🍖 no food mob')
    return
  }

  console.log(`🍖 hunt ${target.name}`)
  bot.pathfinder.setGoal(new GoalFollow(target, 2), true)

  for (let i = 0; i < 20; i++) {
    if (!target.isValid) break
    const d = bot.entity.position.distanceTo(target.position)
    if (d <= 3) break
    await sleep(200)
  }

  try {
    for (let i = 0; i < 4; i++) {
      if (!target.isValid) break
      await bot.lookAt(target.position.offset(0, 1, 0))
      bot.attack(target)
      await sleep(450)
    }

    memory.knownFoodSpots ??= []
    memory.knownFoodSpots.push({
      x: Math.floor(target.position.x),
      y: Math.floor(target.position.y),
      z: Math.floor(target.position.z),
      name: target.name,
      time: Date.now()
    })
    if (memory.knownFoodSpots.length > 100) memory.knownFoodSpots = memory.knownFoodSpots.slice(-100)

    journal(memory, `hunted ${target.name}`)
  } catch (e) {
    console.log('hunt error:', e.message)
  } finally {
    bot.pathfinder.setGoal(null)
  }
}

module.exports = { gatherFood }
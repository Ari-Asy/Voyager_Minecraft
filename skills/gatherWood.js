const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const { journal } = require('../core/memory')

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function gatherWood(bot, memory) {
  const logIds = bot.registry.blocksArray
    .filter(b => b.name && b.name.includes('log'))
    .map(b => b.id)

  const block = bot.findBlock({
    matching: logIds,
    maxDistance: 40
  })

  if (!block) {
    console.log('❌ no tree')
    return
  }

  console.log(`🌲 tree -> ${block.name} @ ${block.position.x},${block.position.y},${block.position.z}`)
  bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, 1))

  let reached = false
  for (let i = 0; i < 15; i++) {
    if (bot.entity.position.distanceTo(block.position) <= 3) {
      reached = true
      break
    }
    await sleep(200)
  }

  if (!reached) {
    console.log('⚠️ tree unreachable')
    return
  }

  try {
    const current = bot.blockAt(block.position)
    if (!current) return
    console.log(`🪓 dig ${current.name}`)
    await bot.dig(current)

    memory.knownTrees ??= []
    memory.knownTrees.push({
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
      name: block.name,
      time: Date.now()
    })
    if (memory.knownTrees.length > 100) memory.knownTrees = memory.knownTrees.slice(-100)

    journal(memory, `cut ${block.name}`)
  } catch (e) {
    console.log('dig error:', e.message)
  }
}

module.exports = { gatherWood }
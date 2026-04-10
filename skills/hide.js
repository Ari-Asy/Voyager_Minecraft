const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function hide(bot) {
  const p = bot.entity.position
  // Try to find a sheltered spot (look for blocks overhead or nearby walls)
  const below = bot.blockAt(p.offset(0, -1, 0))
  
  // Strategy: move to a random nearby position and crouch
  const tx = Math.floor(p.x + (Math.random() * 10 - 5))
  const tz = Math.floor(p.z + (Math.random() * 10 - 5))
  const ty = Math.floor(p.y)

  console.log(`🏠 hide -> ${tx}, ${ty}, ${tz}`)
  bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1))
  
  // Crouch to reduce visibility
  bot.setControlState('sneak', true)
  await sleep(2000)
  bot.setControlState('sneak', false)
}

module.exports = { hide }
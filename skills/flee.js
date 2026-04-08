const { goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function flee(bot) {
  const p = bot.entity.position
  const tx = Math.floor(p.x + (Math.random() * 18 - 9))
  const tz = Math.floor(p.z + (Math.random() * 18 - 9))
  const ty = Math.floor(p.y)

  console.log(`🚨 flee -> ${tx}, ${ty}, ${tz}`)
  bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1))
  await sleep(1000)
}

module.exports = { flee }
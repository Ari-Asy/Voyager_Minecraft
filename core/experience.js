const config = require('../config')

/**
 * Experience Manager — records outcomes of every action for learning.
 * Inspired by Voyager's event recording system.
 */

function createSnapshot(bot) {
  return {
    health: bot.health,
    food: bot.food,
    position: {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z)
    },
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })),
    timeOfDay: bot.time?.timeOfDay ?? 0
  }
}

function computeInventoryDiff(before, after) {
  const beforeMap = {}
  const afterMap = {}
  for (const i of before) beforeMap[i.name] = (beforeMap[i.name] || 0) + i.count
  for (const i of after) afterMap[i.name] = (afterMap[i.name] || 0) + i.count

  const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)])
  const diff = {}
  for (const key of allKeys) {
    const d = (afterMap[key] || 0) - (beforeMap[key] || 0)
    if (d !== 0) diff[key] = d
  }
  return diff
}

function computeReward(result, healthDiff, foodDiff, inventoryDiff) {
  let reward = 0

  // Success bonus
  if (result.success) reward += 1.0

  // Health changes
  if (healthDiff < 0) reward -= 0.5 * Math.abs(healthDiff)
  if (healthDiff > 0) reward += 0.2 * healthDiff

  // Food changes (less important)
  if (foodDiff < -3) reward -= 0.1

  // Inventory gains are valuable
  const gains = Object.values(inventoryDiff).filter(v => v > 0)
  const losses = Object.values(inventoryDiff).filter(v => v < 0)
  reward += gains.reduce((s, v) => s + v * 0.1, 0)
  reward -= losses.reduce((s, v) => s + Math.abs(v) * 0.05, 0)

  return Math.round(reward * 100) / 100
}

function recordExperience(memory, action, task, beforeSnap, afterSnap, success, errorMsg) {
  const duration = Date.now() - (beforeSnap._timestamp || Date.now())
  const inventoryDiff = computeInventoryDiff(beforeSnap.inventory, afterSnap.inventory)
  const healthDiff = afterSnap.health - beforeSnap.health
  const foodDiff = afterSnap.food - beforeSnap.food

  const result = { success, duration, error: errorMsg || null }
  const reward = computeReward(result, healthDiff, foodDiff, inventoryDiff)

  const entry = {
    id: `exp_${Date.now()}`,
    timestamp: Date.now(),
    action,
    task: task || action,
    context: {
      health: beforeSnap.health,
      food: beforeSnap.food,
      isNight: beforeSnap.timeOfDay >= 13000,
      position: beforeSnap.position
    },
    result,
    inventoryDiff,
    healthDiff,
    foodDiff,
    reward
  }

  if (!Array.isArray(memory.experience)) memory.experience = []
  memory.experience.push(entry)

  // Keep only recent entries
  const maxEntries = config.experience?.maxEntries || 500
  if (memory.experience.length > maxEntries) {
    memory.experience = memory.experience.slice(-maxEntries)
  }

  console.log(`📊 EXP: ${action} ${success ? '✅' : '❌'} reward=${reward} inv=${JSON.stringify(inventoryDiff)}`)
  return entry
}

/**
 * Summarize recent experiences for LLM prompt context.
 */
function summarizeExperience(memory) {
  if (!memory.experience || memory.experience.length === 0) {
    return 'No previous experience.'
  }

  const count = config.experience?.summaryCount || 10
  const recent = memory.experience.slice(-count)

  // Aggregate stats per action
  const stats = {}
  for (const exp of memory.experience.slice(-50)) {
    const key = exp.action || exp.task
    if (!stats[key]) stats[key] = { attempts: 0, successes: 0, totalReward: 0 }
    stats[key].attempts++
    if (exp.result?.success) stats[key].successes++
    stats[key].totalReward += exp.reward || 0
  }

  let summary = 'Recent action stats (last 50):\n'
  for (const [action, s] of Object.entries(stats)) {
    const rate = s.attempts > 0 ? Math.round(s.successes / s.attempts * 100) : 0
    summary += `- ${action}: ${s.successes}/${s.attempts} success (${rate}%), avg reward=${(s.totalReward / s.attempts).toFixed(2)}\n`
  }

  summary += '\nLast actions:\n'
  for (const exp of recent) {
    const icon = exp.result?.success ? '✅' : '❌'
    summary += `- ${icon} ${exp.action}: ${exp.result?.error || 'ok'}\n`
  }

  return summary
}

/**
 * Get experience-based preference adjustments for planning.
 */
function getExperienceHints(memory) {
  if (!memory.experience || memory.experience.length < 5) return ''

  const recent = memory.experience.slice(-30)
  const hints = []

  // Check for repeated failures
  const failCounts = {}
  for (const exp of recent) {
    if (!exp.result?.success) {
      failCounts[exp.action] = (failCounts[exp.action] || 0) + 1
    }
  }

  for (const [action, count] of Object.entries(failCounts)) {
    if (count >= 3) {
      hints.push(`Warning: "${action}" has failed ${count} times recently. Consider alternatives.`)
    }
  }

  // Check for death patterns
  const deaths = recent.filter(e => e.healthDiff < -10)
  if (deaths.length > 0) {
    const lastDeath = deaths[deaths.length - 1]
    if (lastDeath.context?.isNight) {
      hints.push('Warning: Bot died at night recently. Prioritize hiding at night.')
    }
  }

  return hints.join('\n')
}

module.exports = { createSnapshot, recordExperience, summarizeExperience, getExperienceHints }

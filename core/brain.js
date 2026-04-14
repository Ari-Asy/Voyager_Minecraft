const { plan } = require('./planner')

function locked(memory) {
  return Date.now() < (memory.runtime?.targetLockUntil || 0)
}

async function decide(state, memory) {
  if (locked(memory) && memory.runtime?.currentPlan?.action) {
    return memory.runtime.currentPlan
  }

  const next = await plan(state, memory)
  return next
}

module.exports = { decide }
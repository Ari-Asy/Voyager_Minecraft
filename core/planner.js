const config = require('../config')

async function askOllama(state) {
  const prompt = `
You are the long-term planner for a Minecraft survival NPC.
Return ONLY valid JSON.
Choose one action from:
- panic
- eat_food
- gather_food
- gather_wood
- craft_basic
- hide
- roam

Rules:
- If hostile nearby or health low => panic
- If food <= ${config.thresholds.emergencyFood} and edible food exists => eat_food
- If food <= ${config.thresholds.lowFood} and no edible food => gather_food
- If logCount < 8 => gather_wood
- If plankCount < 8 or no crafting table => craft_basic
- If isNight => hide
- Else roam

Return format:
{"action":"gather_wood","reason":"short reason"}
State:
${JSON.stringify(state)}
`.trim()

  const res = await fetch(config.ollama.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false,
      format: 'json'
    })
  })

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = await res.json()
  return JSON.parse(data.response)
}

function fallbackPlan(state) {
  if (state.hostile || state.health <= config.thresholds.lowHealth) {
    return { action: 'panic', reason: 'danger fallback' }
  }
  if (state.food <= config.thresholds.emergencyFood && state.edibleFood) {
    return { action: 'eat_food', reason: 'eat fallback' }
  }
  if (state.food <= config.thresholds.lowFood && !state.edibleFood) {
    return { action: 'gather_food', reason: 'need food fallback' }
  }
  if (state.logCount < 8) {
    return { action: 'gather_wood', reason: 'need wood fallback' }
  }
  if (state.plankCount < 8 || !state.hasCraftingTable) {
    return { action: 'craft_basic', reason: 'need basics fallback' }
  }
  if (state.isNight) {
    return { action: 'hide', reason: 'night fallback' }
  }
  return { action: 'roam', reason: 'default fallback' }
}

async function plan(state) {
  if (!config.ollama.enabled) return fallbackPlan(state)
  try {
    return await askOllama(state)
  } catch (e) {
    console.log('planner fallback:', e.message)
    return fallbackPlan(state)
  }
}

module.exports = { plan }
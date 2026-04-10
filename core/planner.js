const config = require('../config')
const { summarizeExperience, getExperienceHints } = require('./experience')

async function askOllama(state, experienceContext) {
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

${experienceContext ? `\nLearning from past experience:\n${experienceContext}\n` : ''}

Return format:
{"action":"gather_wood","reason":"short reason"}
State:
${JSON.stringify(state)}
`.trim()

  const res = await fetch(`${config.ollama.endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.planModel,
      prompt,
      stream: false,
      format: 'json'
    })
  })

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = await res.json()
  return JSON.parse(data.response)
}

function fallbackPlan(state, experienceHints) {
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

async function plan(state, memory) {
  // Gather experience context for LLM
  const experienceSummary = summarizeExperience(memory)
  const experienceHints = getExperienceHints(memory)
  const experienceContext = experienceHints
    ? `${experienceSummary}\n${experienceHints}`
    : experienceSummary

  if (!config.ollama.enabled) return fallbackPlan(state, experienceHints)
  try {
    return await askOllama(state, experienceContext)
  } catch (e) {
    console.log('planner fallback:', e.message)
    return fallbackPlan(state, experienceHints)
  }
}

module.exports = { plan }
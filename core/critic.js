const config = require('../config')
const { ollamaGenerate } = require('./ollama_helper')

const BUILTIN_RULES = {
  gather_wood: (before, after) => {
    const logsBefore = before.inventory.filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0)
    const logsAfter = after.inventory.filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0)
    if (logsAfter > logsBefore) return { success: true, critique: '' }
    return { success: false, critique: 'No logs were collected. Try moving to find trees first.' }
  },
  eat_food: (before, after) => {
    if (after.food > before.food) return { success: true, critique: '' }
    return { success: false, critique: 'Food level did not increase.' }
  },
  gather_food: (before, after) => {
    const foodItems = ['beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon', 'bread', 'apple', 'cooked']
    const foodBefore = before.inventory.filter(i => foodItems.some(f => i.name.includes(f))).reduce((s, i) => s + i.count, 0)
    const foodAfter = after.inventory.filter(i => foodItems.some(f => i.name.includes(f))).reduce((s, i) => s + i.count, 0)
    if (foodAfter > foodBefore) return { success: true, critique: '' }
    return { success: false, critique: 'No food items gained.' }
  },
  craft_basic: (before, after) => {
    const typesBefore = new Set(before.inventory.map(i => i.name))
    const typesAfter = new Set(after.inventory.map(i => i.name))
    const newTypes = [...typesAfter].filter(t => !typesBefore.has(t))
    if (newTypes.length > 0) return { success: true, critique: '' }
    return { success: false, critique: 'No new items were crafted.' }
  },
  panic: (before, after) => after.health > 0 ? { success: true, critique: '' } : { success: false, critique: 'Bot died while panicking.' },
  flee: (before, after) => after.health > 0 ? { success: true, critique: '' } : { success: false, critique: 'Bot died while fleeing.' },
  hide: (before, after) => after.health > 0 ? { success: true, critique: '' } : { success: false, critique: 'Bot died while hiding.' },
  roam: () => ({ success: true, critique: '' })
}

function checkBuiltinSuccess(action, beforeSnap, afterSnap) {
  const rule = BUILTIN_RULES[action]
  return rule ? rule(beforeSnap, afterSnap) : { success: true, critique: '' }
}

async function checkTaskSuccessLLM(task, beforeSnap, afterSnap) {
  try {
    const prompt = `
You are a Minecraft task verification assistant.
Determine if the following task was completed successfully.

Task: ${task}

State BEFORE action:
- Health: ${beforeSnap.health}/20
- Food: ${beforeSnap.food}/20
- Inventory: ${beforeSnap.inventory.map(i => `${i.name}x${i.count}`).join(', ')}

State AFTER action:
- Health: ${afterSnap.health}/20
- Food: ${afterSnap.food}/20
- Inventory: ${afterSnap.inventory.map(i => `${i.name}x${i.count}`).join(', ')}

Return ONLY valid JSON:
{"success": true/false, "critique": "brief explanation"}
`.trim()

    const response = await ollamaGenerate(config.ollama.endpoint, {
      model: config.ollama.planModel,
      prompt,
      format: 'json'
    })
    const result = JSON.parse(response)
    return { success: !!result.success, critique: result.critique || '' }
  } catch (e) {
    console.log('critic LLM fallback:', e.message)
    const invChanged = JSON.stringify(beforeSnap.inventory) !== JSON.stringify(afterSnap.inventory)
    return { success: afterSnap.health > 0 && invChanged, critique: 'LLM verification failed, using heuristic.' }
  }
}

async function verifyAction(action, task, beforeSnap, afterSnap, isBuiltin = true) {
  if (isBuiltin) return checkBuiltinSuccess(action, beforeSnap, afterSnap)
  return await checkTaskSuccessLLM(task || action, beforeSnap, afterSnap)
}

module.exports = { verifyAction, checkBuiltinSuccess, checkTaskSuccessLLM }
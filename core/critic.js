const config = require('../config')

/**
 * Critic Agent — verifies whether a task/action was completed successfully.
 * Inspired by Voyager's CriticAgent with two-layer verification.
 */

// Rules-based verification for built-in actions (fast, no LLM needed)
const BUILTIN_RULES = {
  gather_wood: (before, after) => {
    const logsBefore = before.inventory.filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0)
    const logsAfter = after.inventory.filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0)
    if (logsAfter > logsBefore) return { success: true, critique: '' }
    return { success: false, critique: 'No logs were collected. Try moving to find trees first.' }
  },

  eat_food: (before, after) => {
    if (after.food > before.food) return { success: true, critique: '' }
    return { success: false, critique: 'Food level did not increase. Check if edible food is in inventory.' }
  },

  gather_food: (before, after) => {
    const foodItems = ['beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon', 'bread', 'apple', 'cooked']
    const foodBefore = before.inventory.filter(i => foodItems.some(f => i.name.includes(f))).reduce((s, i) => s + i.count, 0)
    const foodAfter = after.inventory.filter(i => foodItems.some(f => i.name.includes(f))).reduce((s, i) => s + i.count, 0)
    if (foodAfter > foodBefore) return { success: true, critique: '' }
    return { success: false, critique: 'No food items gained. Animals may have run away.' }
  },

  craft_basic: (before, after) => {
    const totalBefore = before.inventory.reduce((s, i) => s + i.count, 0)
    const totalAfter = after.inventory.reduce((s, i) => s + i.count, 0)
    // Crafting usually changes item types
    const typesBefore = new Set(before.inventory.map(i => i.name))
    const typesAfter = new Set(after.inventory.map(i => i.name))
    const newTypes = [...typesAfter].filter(t => !typesBefore.has(t))
    if (newTypes.length > 0) return { success: true, critique: '' }
    return { success: false, critique: 'No new items were crafted. Check if you have the right materials.' }
  },

  panic: (before, after) => {
    // Panic succeeds if bot is still alive
    if (after.health > 0) return { success: true, critique: '' }
    return { success: false, critique: 'Bot died while panicking.' }
  },

  flee: (before, after) => {
    if (after.health > 0) return { success: true, critique: '' }
    return { success: false, critique: 'Bot died while fleeing.' }
  },

  hide: (before, after) => {
    if (after.health > 0) return { success: true, critique: '' }
    return { success: false, critique: 'Bot died while hiding.' }
  },

  roam: () => {
    return { success: true, critique: '' }
  }
}

/**
 * Check if a built-in action succeeded using rules.
 */
function checkBuiltinSuccess(action, beforeSnap, afterSnap) {
  const rule = BUILTIN_RULES[action]
  if (rule) {
    return rule(beforeSnap, afterSnap)
  }
  // Unknown action — optimistically assume success if no error
  return { success: true, critique: '' }
}

/**
 * Check if a task succeeded using LLM-based verification.
 * Used for discovered/generated skills where rules don't exist.
 */
async function checkTaskSuccessLLM(task, beforeSnap, afterSnap) {
  try {
    const prompt = `
You are a Minecraft task verification assistant.
Determine if the following task was completed successfully.

Task: ${task}

State BEFORE action:
- Health: ${beforeSnap.health}/20
- Food: ${beforeSnap.food}/20
- Inventory: ${JSON.stringify(beforeSnap.inventory.map(i => `${i.name}x${i.count}`).join(', '))}

State AFTER action:
- Health: ${afterSnap.health}/20
- Food: ${afterSnap.food}/20  
- Inventory: ${JSON.stringify(afterSnap.inventory.map(i => `${i.name}x${i.count}`).join(', '))}

Return ONLY valid JSON:
{"success": true/false, "critique": "brief explanation"}
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
    const result = JSON.parse(data.response)
    return {
      success: !!result.success,
      critique: result.critique || ''
    }
  } catch (e) {
    console.log('critic LLM fallback:', e.message)
    // Fallback: check if health didn't drop and inventory changed
    const invChanged = JSON.stringify(beforeSnap.inventory) !== JSON.stringify(afterSnap.inventory)
    return {
      success: afterSnap.health > 0 && invChanged,
      critique: 'LLM verification failed, using heuristic.'
    }
  }
}

/**
 * Main verification function.
 * Uses rules for built-in actions, LLM for discovered skills.
 */
async function verifyAction(action, task, beforeSnap, afterSnap, isBuiltin = true) {
  if (isBuiltin) {
    return checkBuiltinSuccess(action, beforeSnap, afterSnap)
  }
  return await checkTaskSuccessLLM(task || action, beforeSnap, afterSnap)
}

module.exports = { verifyAction, checkBuiltinSuccess, checkTaskSuccessLLM }

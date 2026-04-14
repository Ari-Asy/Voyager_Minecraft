const config = require('../config')
const { getSkillManager } = require('./skillManager')
const controlPrimitives = require('../skills/controlPrimitives')
const { goals } = require('mineflayer-pathfinder')

/**
 * Skill Discovery — generates new skills via LLM code generation.
 * Inspired by Voyager's ActionAgent + iterative prompting loop.
 * 
 * Flow: task → LLM generates JS code → execute → critic verifies → save to skill library
 */

const SYSTEM_PROMPT = `You are a helpful Minecraft bot assistant that writes JavaScript code using the mineflayer API.

## Available Helper Functions (Control Primitives):
You can use these pre-built functions in your code:

- await mineBlock(bot, blockName, count) — finds and mines a block type
- await craftItem(bot, itemName, count) — crafts an item (finds crafting table if needed)
- await placeItem(bot, itemName, position) — places a block from inventory
- await killMob(bot, mobName, timeout) — hunts and kills a mob
- await smeltItem(bot, itemName, fuelName, count) — smelts items in a furnace
- await exploreUntil(bot, direction, maxTime, callback) — explores until callback returns true

## Bot API (mineflayer):
- bot.entity.position — current position {x, y, z}
- bot.health — current health (0-20)
- bot.food — current food (0-20)
- bot.inventory.items() — array of {name, count}
- bot.findBlock({matching, maxDistance}) — find a block
- bot.dig(block) — mine a block
- bot.equip(item, destination) — equip an item
- bot.consume() — eat held food
- bot.pathfinder.setGoal(goal) — pathfind to goal
- bot.attack(entity) — attack an entity
- bot.lookAt(position) — look at a position
- bot.chat(message) — send chat message

## Rules:
1. Write an async function that takes a single argument "bot"
2. Use the control primitives when possible (they handle pathfinding and error recovery)
3. The function name should describe what it does (camelCase)
4. Handle errors gracefully with try/catch
5. Do NOT use infinite loops
6. Return nothing — just perform the actions

## Response format:
Respond ONLY with JavaScript code wrapped in a code block:\n\`\`\`javascript
async function taskName(bot) {
  // your code here
}
\`\`\`
`

/**
 * Generate code for a task using LLM.
 */
async function generateCode(task, context, existingSkills, errorFeedback) {
  let userPrompt = `Task: ${task}\n`

  if (context) {
    userPrompt += `\nContext: ${context}\n`
  }

  if (existingSkills && existingSkills.length > 0) {
    userPrompt += `\nYou can also call these existing skills:\n`
    for (const skill of existingSkills) {
      // Extract function name from code
      const match = skill.match(/async function (\w+)/)
      if (match) userPrompt += `- ${match[1]}(bot)\n`
    }
  }

  if (errorFeedback) {
    userPrompt += `\nPrevious attempt failed with error:\n${errorFeedback}\nPlease fix the code.\n`
  }

  try {
    const res = await fetch(`${config.ollama.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.codeModel,
        prompt: userPrompt,
        system: SYSTEM_PROMPT,
        stream: false
      })
    })

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    return parseCodeResponse(data.response)
  } catch (e) {
    console.log('skillDiscovery generateCode error:', e.message)
    return null
  }
}

/**
 * Parse LLM response to extract JavaScript code.
 */
function parseCodeResponse(response) {
  if (!response) return null

  // Extract code from markdown code blocks
  const codePattern = /```(?:javascript|js)?\s*\n?([\s\S]*?)```/g
  const matches = []
  let match
  while ((match = codePattern.exec(response)) !== null) {
    matches.push(match[1].trim())
  }

  const code = matches.length > 0 ? matches.join('\n\n') : response.trim()

  // Find the main async function
  const funcMatch = code.match(/async\s+function\s+(\w+)\s*\(\s*bot\s*\)/)
  if (!funcMatch) {
    console.log('skillDiscovery: no async function found in response')
    return null
  }

  return {
    programCode: code,
    programName: funcMatch[1],
    execCode: `await ${funcMatch[1]}(bot);`
  }
}

/**
 * Execute generated code in a sandboxed context.
 */
async function executeGeneratedCode(bot, codeInfo, skillManager) {
  const { programCode, execCode } = codeInfo

  // Build the execution context with control primitives + existing skills

  try {
    // Create a function from the generated code
    const fullCode = `
      const { mineBlock, craftItem, placeItem, killMob, smeltItem, exploreUntil } = controlPrimitives;
      const { GoalNear, GoalFollow, GoalBlock } = goals;
      
      ${programCode}
      
      ${execCode}
    `

    // Execute with timeout
    const timeoutMs = 60000 // 60 second timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Execution timeout (60s)')), timeoutMs)
    )

    const execPromise = (async () => {
      const fn = new Function(
        'bot', 'controlPrimitives', 'goals', 'require',
        `return (async () => { ${fullCode} })()`
      )
      return await fn(bot, controlPrimitives, goals, require)
    })()

    await Promise.race([execPromise, timeoutPromise])

    return { success: true, error: null }
  } catch (e) {
    console.log(`skillDiscovery exec error: ${e.message}`)
    return { success: false, error: e.message }
  }
}

/**
 * Main skill discovery loop — attempt a task with iterative prompting.
 * Inspired by Voyager's rollout() method.
 * 
 * @param {object} bot - mineflayer bot
 * @param {string} task - task to accomplish
 * @param {string} context - additional context
 * @param {object} memory - bot memory
 * @returns {object} { success, programCode, programName }
 */
async function discoverSkill(bot, task, context, memory) {
  const skillManager = getSkillManager()
  const maxRetries = config.skill?.maxRetries || 4

  // Retrieve relevant existing skills
  const existingSkills = await skillManager.retrieveSkills(task)

  let lastError = null
  let lastCode = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`\n🔬 Skill Discovery: attempt ${attempt + 1}/${maxRetries} for "${task}"`)

    // Generate code
    const codeInfo = await generateCode(task, context, existingSkills, lastError)
    if (!codeInfo) {
      console.log('🔬 Failed to generate code')
      lastError = 'Failed to generate any valid code. Make sure to write an async function.'
      continue
    }

    console.log(`🔬 Generated function: ${codeInfo.programName}`)
    lastCode = codeInfo

    // Execute the generated code
    const result = await executeGeneratedCode(bot, codeInfo, skillManager)

    if (result.success) {
      console.log(`🔬 ✅ Skill "${codeInfo.programName}" executed successfully!`)
      return {
        success: true,
        programCode: codeInfo.programCode,
        programName: codeInfo.programName
      }
    }

    // Execution failed — feed error back to LLM
    lastError = result.error
    console.log(`🔬 ❌ Attempt ${attempt + 1} failed: ${result.error}`)
  }

  console.log(`🔬 All ${maxRetries} attempts failed for "${task}"`)
  return { success: false, programCode: null, programName: null }
}

module.exports = { discoverSkill, generateCode, executeGeneratedCode }

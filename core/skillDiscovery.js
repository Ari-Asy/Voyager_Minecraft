const config = require('../config')
const { getSkillManager } = require('./skillManager')
const { ollamaGenerate } = require('./ollama_helper')
const controlPrimitives = require('../skills/controlPrimitives')
const { goals } = require('mineflayer-pathfinder')

const SYSTEM_PROMPT = `You are a helpful Minecraft bot assistant that writes JavaScript code using the mineflayer API.

## Available Helper Functions (Control Primitives):
You can use these pre-built functions in your code:

- await mineBlock(bot, blockName, count) — finds and mines a block type
- await craftItem(bot, itemName, count) — crafts an item (finds crafting table if needed)
- await placeItem(bot, itemName, position) — places a block from inventory
- await killMob(bot, mobName, timeout) — hunts and kills a mob
- await smeltItem(bot, itemName, fuelName, count) — smelts items in a furnace
- await exploreUntil(bot, direction, maxTime, callback) — explores until callback returns true

## Rules:
1. Write an async function that takes a single argument "bot"
2. Use the control primitives when possible
3. The function name should describe what it does (camelCase)
4. Handle errors gracefully with try/catch
5. Do NOT use infinite loops
6. Return nothing — just perform the actions

## Response format:
Respond ONLY with JavaScript code wrapped in a code block:\n\`\`\`javascript
async function taskName(bot) {
  // your code here
}
\`\`\``

async function generateCode(task, context, existingSkills, errorFeedback) {
  let userPrompt = `Task: ${task}\n`
  if (context) userPrompt += `\nContext: ${context}\n`
  if (existingSkills && existingSkills.length > 0) {
    userPrompt += `\nYou can also call these existing skills:\n`
    for (const skill of existingSkills) {
      const match = skill.match(/async function (\w+)/)
      if (match) userPrompt += `- ${match[1]}(bot)\n`
    }
  }
  if (errorFeedback) {
    userPrompt += `\nPrevious attempt failed with error:\n${errorFeedback}\nPlease fix the code.\n`
  }

  try {
    const response = await ollamaGenerate(config.ollama.endpoint, {
      model: config.ollama.codeModel,
      prompt: userPrompt,
      system: SYSTEM_PROMPT
    })
    return parseCodeResponse(response)
  } catch (e) {
    console.log('skillDiscovery generateCode error:', e.message)
    return null
  }
}

function parseCodeResponse(response) {
  if (!response) return null
  const codePattern = /```(?:javascript|js)?\s*\n?([\s\S]*?)```/g
  const matches = []
  let match
  while ((match = codePattern.exec(response)) !== null) {
    matches.push(match[1].trim())
  }
  const code = matches.length > 0 ? matches.join('\n\n') : response.trim()
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

async function executeGeneratedCode(bot, codeInfo) {
  const { programCode, execCode } = codeInfo
  try {
    const fullCode = `
      const { mineBlock, craftItem, placeItem, killMob, smeltItem, exploreUntil } = controlPrimitives;
      const { GoalNear, GoalFollow, GoalBlock } = goals;
      ${programCode}
      ${execCode}
    `
    const timeoutMs = 60000
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Execution timeout (60s)')), timeoutMs)
    )
    const execPromise = (async () => {
      const fn = new Function('bot', 'controlPrimitives', 'goals', 'require',
        `return (async () => { ${fullCode} })()`)
      return await fn(bot, controlPrimitives, goals, require)
    })()
    await Promise.race([execPromise, timeoutPromise])
    return { success: true, error: null }
  } catch (e) {
    console.log(`skillDiscovery exec error: ${e.message}`)
    return { success: false, error: e.message }
  }
}

async function discoverSkill(bot, task, context, memory) {
  const skillManager = getSkillManager()
  const maxRetries = config.skill?.maxRetries || 4
  const existingSkills = await skillManager.retrieveSkills(task)
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`\n🔬 Skill Discovery: attempt ${attempt + 1}/${maxRetries} for "${task}"`)
    const codeInfo = await generateCode(task, context, existingSkills, lastError)
    if (!codeInfo) {
      lastError = 'Failed to generate any valid code. Make sure to write an async function.'
      continue
    }
    console.log(`🔬 Generated function: ${codeInfo.programName}`)
    const result = await executeGeneratedCode(bot, codeInfo)
    if (result.success) {
      console.log(`🔬 ✅ Skill "${codeInfo.programName}" executed successfully!`)
      return { success: true, programCode: codeInfo.programCode, programName: codeInfo.programName }
    }
    lastError = result.error
    console.log(`🔬 ❌ Attempt ${attempt + 1} failed: ${result.error}`)
  }

  console.log(`🔬 All ${maxRetries} attempts failed for "${task}"`)
  return { success: false, programCode: null, programName: null }
}

module.exports = { discoverSkill, generateCode, executeGeneratedCode }
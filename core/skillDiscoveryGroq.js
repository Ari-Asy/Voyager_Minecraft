const config = require('../config')
const { getSkillManager } = require('./skillManager')
const { groqGenerate } = require('./groq_helper')
const controlPrimitives = require('../skills/controlPrimitives')
const { goals } = require('mineflayer-pathfinder')

const SYSTEM_PROMPT = `You are a helpful Minecraft bot assistant that writes JavaScript code using the mineflayer API.

## Available Helper Functions:
- await mineBlock(bot, blockName, count)
- await craftItem(bot, itemName, count)
- await placeItem(bot, itemName, position)
- await killMob(bot, mobName, timeout)
- await smeltItem(bot, itemName, fuelName, count)
- await exploreUntil(bot, direction, maxTime, callback)

## Rules:
1. Write an async function that takes a single argument "bot"
2. Use the helper functions when possible
3. Function name should be camelCase describing the action
4. Handle errors with try/catch
5. Do NOT use infinite loops
6. Return nothing

## Response format:
Respond ONLY with JavaScript code in a code block:
\`\`\`javascript
async function taskName(bot) {
  // code here
}
\`\`\``

async function generateCodeGroq(task, context, existingSkills, errorFeedback) {
    let userPrompt = `Task: ${task}\n`
    if (context) userPrompt += `\nContext: ${context}\n`
    if (existingSkills && existingSkills.length > 0) {
        userPrompt += `\nExisting skills you can call:\n`
        for (const skill of existingSkills) {
            const match = skill.match(/async function (\w+)/)
            if (match) userPrompt += `- ${match[1]}(bot)\n`
        }
    }
    if (errorFeedback) {
        userPrompt += `\nPrevious attempt failed:\n${errorFeedback}\nPlease fix the code.\n`
    }

    try {
        const response = await groqGenerate(userPrompt, SYSTEM_PROMPT)
        return parseCodeResponse(response)
    } catch (e) {
        console.log('skillDiscoveryGroq generateCode error:', e.message)
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
        console.log('skillDiscoveryGroq: no async function found')
        return null
    }
    return { programCode: code, programName: funcMatch[1], execCode: `await ${funcMatch[1]}(bot);` }
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
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Execution timeout (60s)')), 60000)
        )
        const execPromise = (async () => {
            const fn = new Function('bot', 'controlPrimitives', 'goals', 'require',
                `return (async () => { ${fullCode} })()`)
            return await fn(bot, controlPrimitives, goals, require)
        })()
        await Promise.race([execPromise, timeoutPromise])
        return { success: true, error: null }
    } catch (e) {
        console.log(`skillDiscoveryGroq exec error: ${e.message}`)
        return { success: false, error: e.message }
    }
}

async function discoverSkillGroq(bot, task, context, memory) {
    const skillManager = getSkillManager(memory._botName)
    const maxRetries = config.skill?.maxRetries || 4
    const existingSkills = await skillManager.retrieveSkills(task)
    let lastError = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`\n[Groq] Skill Discovery: attempt ${attempt + 1}/${maxRetries} for "${task}"`)
        const codeInfo = await generateCodeGroq(task, context, existingSkills, lastError)
        if (!codeInfo) {
            lastError = 'Failed to generate valid code.'
            continue
        }
        console.log(`[Groq] Generated: ${codeInfo.programName}`)
        const result = await executeGeneratedCode(bot, codeInfo)
        if (result.success) {
            console.log(`[Groq] Skill "${codeInfo.programName}" succeeded!`)
            return { success: true, programCode: codeInfo.programCode, programName: codeInfo.programName }
        }
        lastError = result.error
        console.log(`[Groq] Attempt ${attempt + 1} failed: ${result.error}`)
    }

    return { success: false, programCode: null, programName: null }
}

module.exports = { discoverSkillGroq }
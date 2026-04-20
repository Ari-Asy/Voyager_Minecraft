const config = require('../config')
const { perceive } = require('./perception')
const { decide } = require('./brain')
const { execute } = require('./executor')
const { saveMemory } = require('./memory')
const { CurriculumAgent } = require('./curriculum')
const { getSkillManager } = require('./skillManager')
const { createSnapshot, recordExperience } = require('./experience')
const { verifyAction } = require('./critic')
const { sendSkill, sendStatus } = require('./chatProtocol')

// llmType = 'ollama' | 'groq'
const { discoverSkill } = require('./skillDiscovery')
const { discoverSkillGroq } = require('./skillDiscoveryGroq')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function heartbeat(bot, memory) {
  while (true) {
    try {
      if (memory.runtime?.learningActive) {
        await sleep(config.loops.heartbeatMs)
        continue
      }
      const state = perceive(bot, memory)
      if (state.hostile || state.health <= config.thresholds.lowHealth) {
        memory.runtime.currentPlan = { action: 'panic', reason: 'heartbeat emergency' }
      } else if (state.food <= config.thresholds.emergencyFood && state.edibleFood) {
        memory.runtime.currentPlan = { action: 'eat_food', reason: 'heartbeat emergency eat' }
      }
    } catch (e) { console.log('heartbeat error:', e.message || e) }
    await sleep(config.loops.heartbeatMs)
  }
}

async function thinkLoop(bot, memory) {
  while (true) {
    try {
      if (memory.runtime.learningActive) {
        await sleep(1000)
        continue
      }
      const state = perceive(bot, memory)
      const plan = memory.runtime.currentPlan?.action === 'panic'
        ? memory.runtime.currentPlan
        : await decide(state, memory)

      console.log(`[${memory._botName}] STATE: health=${state.health} food=${state.food} hostile=${state.hostile?.name || null}`)
      console.log(`[${memory._botName}] PLAN:`, plan)

      await execute(bot, memory, plan)
      memory.runtime.lastThink = Date.now()
    } catch (e) { console.log(`[${memory._botName}] think error:`, e.message || e) }
    await sleep(config.loops.thinkMs)
  }
}

async function learningLoop(bot, memory, llmType) {
  await sleep(5000)

  const discover = llmType === 'groq' ? discoverSkillGroq : discoverSkill
  const curriculum = new CurriculumAgent(memory)
  const skillManager = getSkillManager(memory._botName) // แยก skill library ตาม bot
  let iteration = 0
  const maxIterations = config.curriculum?.maxIterations || 160
  const tag = `[${memory._botName}]`

  console.log(`\n${tag} LEARNING LOOP STARTED (${llmType.toUpperCase()})`)
  console.log(`${tag} Completed: ${curriculum.completedTasks.length} | Failed: ${curriculum.failedTasks.length}\n`)

  while (iteration < maxIterations) {
    try {
      const state = perceive(bot, memory)
      if (state.health <= config.thresholds.lowHealth || state.hostile) {
        console.log(`${tag} Pausing learning for survival...`)
        memory.runtime.learningActive = false
        await sleep(5000)
        continue
      }

      memory.runtime.learningActive = true

      const { task, context } = await curriculum.proposeNextTask(state)
      memory.currentTask = task

      console.log(`\n${tag} Task #${iteration + 1}: ${task}`)

      const beforeSnap = createSnapshot(bot)
      beforeSnap._timestamp = Date.now()

      const result = await discover(bot, task, context, memory)

      const afterSnap = createSnapshot(bot)

      let success = result.success
      if (success) {
        const verification = await verifyAction(result.programName || task, task, beforeSnap, afterSnap, false)
        success = verification.success
        if (!success) console.log(`${tag} Critic rejected: ${verification.critique}`)
      }

      recordExperience(memory, result.programName || task, task, beforeSnap, afterSnap, success, success ? null : 'Task not completed')
      curriculum.updateProgress({ task, success })
      curriculum.syncToMemory(memory)

      if (success && result.programCode && result.programName) {
        await skillManager.addSkill({ programName: result.programName, programCode: result.programCode })
        memory.skillCount = skillManager.skillCount

        // Phase 3: Share skill with partner bot via chunked chat protocol
        await sendSkill(bot, result.programName, result.programCode)
      }

      console.log(`${tag} Progress: ${curriculum.completedTasks.length} completed | Skills: ${skillManager.skillCount}`)

      iteration++
      memory.runtime.learningActive = false

      // Phase 3: Share status periodically
      const statusInterval = config.chat?.statusInterval || 5
      if (iteration % statusInterval === 0) {
        sendStatus(bot, memory)
      }

      await sleep(3000)

    } catch (e) {
      console.log(`${tag} learning error:`, e.message || e)
      memory.runtime.learningActive = false
      await sleep(5000)
    }
  }

  console.log(`\n${tag} LEARNING LOOP COMPLETE`)
}

async function saveLoop(memory) {
  while (true) {
    try { saveMemory(memory) }
    catch (e) { console.log('save error:', e.message || e) }
    await sleep(config.loops.saveMs)
  }
}

// llmType = 'ollama' | 'groq'
function startLoops(bot, memory, llmType = 'ollama') {
  heartbeat(bot, memory)
  thinkLoop(bot, memory)
  saveLoop(memory)
  if (config.curriculum?.enabled) {
    learningLoop(bot, memory, llmType)
  }
}

module.exports = { startLoops }
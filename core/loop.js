const config = require('../config')
const { perceive } = require('./perception')
const { decide } = require('./brain')
const { execute } = require('./executor')
const { saveMemory } = require('./memory')
const { CurriculumAgent } = require('./curriculum')
const { discoverSkill } = require('./skillDiscovery')
const { getSkillManager } = require('./skillManager')
const { createSnapshot, recordExperience } = require('./experience')
const { verifyAction } = require('./critic')

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Heartbeat — emergency reactive loop (fast, runs every 400ms).
 * Handles immediate threats like hostile mobs and low health.
 */
async function heartbeat(bot, memory) {
  while (true) {
    try {
      const state = perceive(bot, memory)

      if (state.hostile || state.health <= config.thresholds.lowHealth) {
        memory.runtime.currentPlan = { action: 'panic', reason: 'heartbeat emergency' }
      } else if (state.food <= config.thresholds.emergencyFood && state.edibleFood) {
        memory.runtime.currentPlan = { action: 'eat_food', reason: 'heartbeat emergency eat' }
      }
    } catch (e) {
      console.log('heartbeat error:', e.message || e)
    }
    await sleep(config.loops.heartbeatMs)
  }
}

/**
 * Survival think loop — reactive planning for immediate needs.
 * Handles basic survival: fleeing, eating, gathering resources.
 */
async function thinkLoop(bot, memory) {
  while (true) {
    try {
      // Skip if learning loop is active
      if (memory.runtime.learningActive) {
        await sleep(config.loops.thinkMs)
        continue
      }

      const state = perceive(bot, memory)
      const plan = memory.runtime.currentPlan?.action === 'panic'
        ? memory.runtime.currentPlan
        : await decide(state, memory)

      console.log('STATE:', {
        health: state.health,
        food: state.food,
        isNight: state.isNight,
        logCount: state.logCount,
        plankCount: state.plankCount,
        edibleFood: state.edibleFood,
        hostile: state.hostile?.name || null,
        tree: state.tree?.name || null,
        foodMob: state.foodMob?.name || null
      })

      console.log('PLAN:', plan)

      await execute(bot, memory, plan)
      memory.runtime.lastThink = Date.now()
    } catch (e) {
      console.log('think error:', e.message || e)
    }
    await sleep(config.loops.thinkMs)
  }
}

/**
 * Learning loop — curriculum-driven skill discovery.
 * Inspired by Voyager's learn() method.
 * 
 * Flow:
 * 1. Curriculum proposes task
 * 2. Skill Manager retrieves relevant skills
 * 3. Skill Discovery generates code via LLM
 * 4. Execute → Critic verifies
 * 5. Success → Save skill → Next task
 * 6. Fail → Retry with error feedback → Skip if max retries
 */
async function learningLoop(bot, memory) {
  // Wait for bot to stabilize
  await sleep(5000)

  const curriculum = new CurriculumAgent(memory)
  const skillManager = getSkillManager()
  let iteration = 0
  const maxIterations = config.curriculum?.maxIterations || 160

  console.log('\n🎓 ═══════════════════════════════════════')
  console.log('🎓  LEARNING LOOP STARTED')
  console.log(`🎓  Completed: ${curriculum.completedTasks.length} | Failed: ${curriculum.failedTasks.length}`)
  console.log('🎓 ═══════════════════════════════════════\n')

  while (iteration < maxIterations) {
    try {
      // Check if bot needs basic survival
      const state = perceive(bot, memory)
      if (state.health <= config.thresholds.lowHealth || state.hostile) {
        console.log('🎓 Pausing learning for survival...')
        memory.runtime.learningActive = false
        await sleep(5000)
        continue
      }

      memory.runtime.learningActive = true

      // 1. Propose next task
      const { task, context } = await curriculum.proposeNextTask(state)
      memory.currentTask = task

      console.log('\n🎓 ═══════════════════════════════════════')
      console.log(`🎓  Task #${iteration + 1}: ${task}`)
      console.log(`🎓  Context: ${context}`)
      console.log('🎓 ═══════════════════════════════════════\n')

      // 2. Take snapshot before
      const beforeSnap = createSnapshot(bot)
      beforeSnap._timestamp = Date.now()

      // 3. Attempt task via skill discovery
      const result = await discoverSkill(bot, task, context, memory)

      // 4. Take snapshot after
      const afterSnap = createSnapshot(bot)

      // 5. Verify with critic
      let success = result.success
      if (success) {
        const verification = await verifyAction(
          result.programName || task,
          task,
          beforeSnap,
          afterSnap,
          false // not built-in, use LLM critic
        )
        success = verification.success
        if (!success) {
          console.log(`🎓 Critic rejected: ${verification.critique}`)
        }
      }

      // 6. Record experience
      recordExperience(
        memory,
        result.programName || task,
        task,
        beforeSnap,
        afterSnap,
        success,
        success ? null : 'Task not completed'
      )

      // 7. Update curriculum
      curriculum.updateProgress({ task, success })
      curriculum.syncToMemory(memory)

      // 8. Save skill if successful
      if (success && result.programCode && result.programName) {
        await skillManager.addSkill({
          programName: result.programName,
          programCode: result.programCode
        })
        memory.skillCount = skillManager.skillCount
      }

      // Log progress
      console.log(`\n🎓 Progress: ${curriculum.completedTasks.length} completed, ${curriculum.failedTasks.length} failed`)
      console.log(`🎓 Skills in library: ${skillManager.skillCount}`)

      iteration++
      memory.runtime.learningActive = false

      // Small delay between tasks
      await sleep(3000)

    } catch (e) {
      console.log('learning error:', e.message || e)
      memory.runtime.learningActive = false
      await sleep(5000)
    }
  }

  console.log('\n🎓 ═══════════════════════════════════════')
  console.log('🎓  LEARNING LOOP COMPLETE')
  console.log(`🎓  Total completed: ${curriculum.completedTasks.length}`)
  console.log(`🎓  Total failed: ${curriculum.failedTasks.length}`)
  console.log(`🎓  Skills learned: ${skillManager.skillCount}`)
  console.log('🎓 ═══════════════════════════════════════\n')
}

async function saveLoop(memory) {
  while (true) {
    try {
      saveMemory(memory)
    } catch (e) {
      console.log('save error:', e.message || e)
    }
    await sleep(config.loops.saveMs)
  }
}

function startLoops(bot, memory) {
  // Core survival loops
  heartbeat(bot, memory)
  thinkLoop(bot, memory)
  saveLoop(memory)

  // Learning loop — curriculum-driven skill discovery
  if (config.curriculum?.enabled) {
    learningLoop(bot, memory)
  }
}

module.exports = { startLoops }
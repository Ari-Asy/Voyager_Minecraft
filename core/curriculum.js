const config = require('../config')

/**
 * Curriculum Agent — proposes the next task for the agent.
 * Inspired by Voyager's CurriculumAgent with progressive task difficulty.
 */

// Predefined fallback progression (when LLM doesn't respond)
const FALLBACK_TASKS = [
  { task: 'Mine 1 wood log', context: 'You can mine oak, birch, spruce, jungle, acacia, dark oak, or mangrove logs.' },
  { task: 'Craft 4 oak planks', context: 'Use 1 oak log to craft 4 oak planks in your inventory.' },
  { task: 'Craft 4 sticks', context: 'Use 2 oak planks to craft sticks.' },
  { task: 'Craft a crafting table', context: 'Use 4 planks of any kind to craft a crafting table.' },
  { task: 'Craft a wooden pickaxe', context: 'You need 3 planks and 2 sticks. Place the crafting table first if needed.' },
  { task: 'Craft a wooden sword', context: 'You need 2 planks and 1 stick.' },
  { task: 'Craft a wooden axe', context: 'You need 3 planks and 2 sticks.' },
  { task: 'Mine 3 wood logs', context: 'Use your axe to mine 3 logs faster.' },
  { task: 'Mine 8 cobblestone', context: 'Find and mine stone blocks with your wooden pickaxe to get cobblestone.' },
  { task: 'Craft a stone pickaxe', context: 'You need 3 cobblestone and 2 sticks. Use the crafting table.' },
  { task: 'Craft a stone sword', context: 'You need 2 cobblestone and 1 stick.' },
  { task: 'Craft a stone axe', context: 'You need 3 cobblestone and 2 sticks.' },
  { task: 'Kill a cow or pig or chicken', context: 'Find an animal and kill it for food.' },
  { task: 'Craft a furnace', context: 'You need 8 cobblestone to craft a furnace.' },
  { task: 'Mine 3 iron ore', context: 'Find and mine iron ore with your stone pickaxe.' },
  { task: 'Smelt 3 raw iron into iron ingots', context: 'Place the furnace, put raw iron and coal/planks as fuel.' },
  { task: 'Craft an iron pickaxe', context: 'You need 3 iron ingots and 2 sticks.' },
  { task: 'Craft an iron sword', context: 'You need 2 iron ingots and 1 stick.' },
  { task: 'Mine 3 diamonds', context: 'Go deep underground (y < 16) and mine diamond ore with your iron pickaxe.' },
  { task: 'Craft a diamond pickaxe', context: 'You need 3 diamonds and 2 sticks.' }
]

class CurriculumAgent {
  constructor(memory) {
    this.completedTasks = memory.completedTasks || []
    this.failedTasks = memory.failedTasks || []
  }

  get progress() {
    return this.completedTasks.length
  }

  /**
   * Propose the next task using LLM.
   */
  async proposeNextTask(state) {
    // First task is always hardcoded
    if (this.progress === 0) {
      return FALLBACK_TASKS[0]
    }

    // If LLM is enabled, try AI-driven task proposal
    if (config.ollama?.enabled && config.curriculum?.enabled) {
      try {
        const aiTask = await this._proposeAITask(state)
        if (aiTask) return aiTask
      } catch (e) {
        console.log('curriculum AI fallback:', e.message)
      }
    }

    // Fallback: use predefined progression
    return this._proposeFallbackTask()
  }

  async _proposeAITask(state) {
    const completed = this.completedTasks.length > 0
      ? this.completedTasks.join(', ')
      : 'None'
    const failed = this.failedTasks.length > 0
      ? this.failedTasks.slice(-10).join(', ')
      : 'None'

    const inventory = state?.inventory
      ? state.inventory.map(i => `${i.name}x${i.count}`).join(', ') || 'Empty'
      : 'Unknown'

    const prompt = `
You are a Minecraft curriculum planner. Based on the bot's current state, suggest ONE next task.

Current state:
- Health: ${state?.health || '?'}/20
- Food: ${state?.food || '?'}/20
- Position: ${state?.pos ? `${state.pos.x}, ${state.pos.y}, ${state.pos.z}` : 'unknown'}
- Inventory: ${inventory}
- Time: ${state?.isNight ? 'Night' : 'Day'}

Completed tasks: ${completed}
Failed tasks (too hard): ${failed}

Rules:
- Don't suggest completed tasks
- Don't suggest recently failed tasks
- Start simple, get progressively harder
- Follow Minecraft tech tree progression
- Task should be specific and achievable

Return ONLY valid JSON:
{"task": "specific task description", "context": "helpful context for completing the task"}
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

    if (result.task) {
      console.log(`📋 Curriculum AI: "${result.task}"`)
      return { task: result.task, context: result.context || '' }
    }

    throw new Error('No task in response')
  }

  _proposeFallbackTask() {
    // Find the next uncompleted task in the fallback list
    for (const entry of FALLBACK_TASKS) {
      if (!this.completedTasks.includes(entry.task)) {
        console.log(`📋 Curriculum fallback: "${entry.task}"`)
        return entry
      }
    }

    // All fallback tasks completed — generate exploration tasks
    const exploreTask = {
      task: `Explore and collect new resources`,
      context: 'You have completed all basic tasks. Explore the world to find new biomes and resources.'
    }
    console.log(`📋 Curriculum: all fallback tasks done, exploring`)
    return exploreTask
  }

  /**
   * Update progress after task attempt.
   */
  updateProgress(info) {
    const { task, success } = info

    if (success) {
      console.log(`📋 ✅ Completed: "${task}"`)
      if (!this.completedTasks.includes(task)) {
        this.completedTasks.push(task)
      }
      // Remove from failed if previously failed
      this.failedTasks = this.failedTasks.filter(t => t !== task)
    } else {
      console.log(`📋 ❌ Failed: "${task}"`)
      this.failedTasks.push(task)
    }

    // Keep failed tasks manageable
    if (this.failedTasks.length > 50) {
      this.failedTasks = this.failedTasks.slice(-50)
    }
  }

  /**
   * Get context for a specific task (using LLM QA).
   */
  async getTaskContext(task) {
    try {
      const prompt = `How to ${task.toLowerCase()} in Minecraft? Give a brief, practical answer.`

      const res = await fetch(`${config.ollama.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.planModel,
          prompt,
          stream: false
        })
      })

      if (!res.ok) return ''
      const data = await res.json()
      return data.response?.trim()?.substring(0, 500) || ''
    } catch (e) {
      return ''
    }
  }

  /**
   * Sync state to memory for persistence.
   */
  syncToMemory(memory) {
    memory.completedTasks = this.completedTasks
    memory.failedTasks = this.failedTasks
  }
}

module.exports = { CurriculumAgent }

const fs = require('fs')
const path = require('path')
const config = require('../config')

/**
 * Skill Manager — stores, retrieves, and manages the skill library.
 * Inspired by Voyager's SkillManager with vector search via Ollama embeddings.
 */

const stateDir = path.join(__dirname, '..', 'state')
const skillsFile = path.join(stateDir, 'skills.json')
const skillCodeDir = path.join(stateDir, 'skill_code')
const embeddingsFile = path.join(stateDir, 'skill_embeddings.json')

class SkillManager {
  constructor() {
    this.skills = {}       // { name: { code, description, stats } }
    this.embeddings = {}   // { name: [vector] }
    this.controlPrimitives = null
    this._loadControlPrimitives()
    this._load()
  }

  _loadControlPrimitives() {
    try {
      const primitivesPath = path.join(__dirname, '..', 'skills', 'controlPrimitives.js')
      this.controlPrimitives = fs.readFileSync(primitivesPath, 'utf8')
    } catch (e) {
      console.log('skillManager: could not load control primitives:', e.message)
      this.controlPrimitives = ''
    }
  }

  _load() {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
    if (!fs.existsSync(skillCodeDir)) fs.mkdirSync(skillCodeDir, { recursive: true })

    if (fs.existsSync(skillsFile)) {
      try {
        this.skills = JSON.parse(fs.readFileSync(skillsFile, 'utf8'))
        console.log(`📚 Loaded ${Object.keys(this.skills).length} skills`)
      } catch (e) {
        console.log('skillManager load error:', e.message)
        this.skills = {}
      }
    }

    if (fs.existsSync(embeddingsFile)) {
      try {
        this.embeddings = JSON.parse(fs.readFileSync(embeddingsFile, 'utf8'))
      } catch (e) {
        this.embeddings = {}
      }
    }
  }

  _save() {
    fs.writeFileSync(skillsFile, JSON.stringify(this.skills, null, 2))
    fs.writeFileSync(embeddingsFile, JSON.stringify(this.embeddings))
  }

  /**
   * Generate embedding vector using Ollama nomic-embed-text.
   */
  async _getEmbedding(text) {
    try {
      const res = await fetch(`${config.ollama.endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.embedModel,
          input: text
        })
      })

      if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`)
      const data = await res.json()
      return data.embeddings?.[0] || null
    } catch (e) {
      console.log('embedding error:', e.message)
      return null
    }
  }

  /**
   * Cosine similarity between two vectors.
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  /**
   * Generate a skill description using LLM.
   */
  async _generateDescription(programName, programCode) {
    try {
      const prompt = `Describe what the following Minecraft bot JavaScript function does in one short sentence.
The main function is \`${programName}\`.

${programCode}

Description:`

      const res = await fetch(`${config.ollama.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.planModel,
          prompt,
          stream: false
        })
      })

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      const data = await res.json()
      return data.response?.trim() || `Function ${programName}`
    } catch (e) {
      return `Function ${programName}`
    }
  }

  /**
   * Add a new skill to the library.
   * Inspired by Voyager's SkillManager.add_new_skill()
   */
  async addSkill(info) {
    const { programName, programCode } = info
    if (!programName || !programCode) return

    // Generate description
    const description = await this._generateDescription(programName, programCode)
    console.log(`📚 Skill description for ${programName}: ${description}`)

    // Handle existing skill (version it)
    let codeFileName = programName
    if (this.skills[programName]) {
      console.log(`📚 Skill ${programName} exists, updating`)
      let i = 2
      while (fs.existsSync(path.join(skillCodeDir, `${programName}V${i}.js`))) i++
      codeFileName = `${programName}V${i}`
    }

    // Save code file
    fs.writeFileSync(path.join(skillCodeDir, `${codeFileName}.js`), programCode)

    // Store skill entry
    this.skills[programName] = {
      code: programCode,
      description,
      stats: this.skills[programName]?.stats || { attempts: 0, successes: 0 }
    }

    // Generate and store embedding
    const embedding = await this._getEmbedding(description)
    if (embedding) {
      this.embeddings[programName] = embedding
    }

    this._save()
    console.log(`📚 Saved skill: ${programName} (total: ${Object.keys(this.skills).length})`)
  }

  /**
   * Update skill stats after execution.
   */
  updateStats(skillName, success) {
    if (this.skills[skillName]) {
      this.skills[skillName].stats.attempts++
      if (success) this.skills[skillName].stats.successes++
      this._save()
    }
  }

  /**
   * Retrieve top-K skills relevant to a query using vector similarity.
   * Falls back to keyword matching if embeddings unavailable.
   */
  async retrieveSkills(query) {
    const k = Math.min(
      Object.keys(this.skills).length,
      config.skill?.retrievalTopK || 5
    )

    if (k === 0) return []

    // Try vector search first
    const queryEmbedding = await this._getEmbedding(query)

    if (queryEmbedding && Object.keys(this.embeddings).length > 0) {
      // Vector similarity search
      const scored = []
      for (const [name, embedding] of Object.entries(this.embeddings)) {
        if (this.skills[name]) {
          scored.push({
            name,
            score: this._cosineSimilarity(queryEmbedding, embedding)
          })
        }
      }

      scored.sort((a, b) => b.score - a.score)
      const topK = scored.slice(0, k)

      console.log(`📚 Retrieved skills (vector): ${topK.map(s => `${s.name}(${s.score.toFixed(2)})`).join(', ')}`)
      return topK.map(s => this.skills[s.name].code)
    }

    // Fallback: keyword matching
    const queryLower = query.toLowerCase()
    const matched = []
    for (const [name, skill] of Object.entries(this.skills)) {
      const text = `${name} ${skill.description}`.toLowerCase()
      const score = queryLower.split(/\s+/).filter(w => text.includes(w)).length
      if (score > 0) matched.push({ name, score })
    }

    matched.sort((a, b) => b.score - a.score)
    const topK = matched.slice(0, k)

    console.log(`📚 Retrieved skills (keyword): ${topK.map(s => s.name).join(', ')}`)
    return topK.map(s => this.skills[s.name].code)
  }

  /**
   * Get all skill code as a single string for LLM context.
   */
  get programs() {
    let programs = ''
    for (const [name, entry] of Object.entries(this.skills)) {
      programs += `${entry.code}\n\n`
    }
    if (this.controlPrimitives) {
      programs += this.controlPrimitives + '\n\n'
    }
    return programs
  }

  get skillCount() {
    return Object.keys(this.skills).length
  }
}

// Singleton instance
let _instance = null
function getSkillManager() {
  if (!_instance) _instance = new SkillManager()
  return _instance
}

module.exports = { getSkillManager, SkillManager }

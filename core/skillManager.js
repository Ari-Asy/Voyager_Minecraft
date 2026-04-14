const fs = require('fs')
const path = require('path')
const config = require('../config')
const { ollamaGenerate } = require('./ollama_helper')

const stateDir = path.join(__dirname, '..', 'state')
const skillsFile = path.join(stateDir, 'skills.json')
const skillCodeDir = path.join(stateDir, 'skill_code')
const embeddingsFile = path.join(stateDir, 'skill_embeddings.json')

class SkillManager {
  constructor() {
    this.skills = {}
    this.embeddings = {}
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
        this.skills = {}
      }
    }
    if (fs.existsSync(embeddingsFile)) {
      try { this.embeddings = JSON.parse(fs.readFileSync(embeddingsFile, 'utf8')) }
      catch (e) { this.embeddings = {} }
    }
  }

  _save() {
    fs.writeFileSync(skillsFile, JSON.stringify(this.skills, null, 2))
    fs.writeFileSync(embeddingsFile, JSON.stringify(this.embeddings))
  }

  async _generateDescription(programName, programCode) {
    try {
      const response = await ollamaGenerate(config.ollama.endpoint, {
        model: config.ollama.planModel,
        prompt: `Describe what this Minecraft bot function does in one short sentence.\nFunction name: ${programName}\n\n${programCode.substring(0, 500)}\n\nDescription:`
      })
      return response.trim().substring(0, 200) || `Function ${programName}`
    } catch (e) {
      return `Function ${programName}`
    }
  }

  async addSkill(info) {
    const { programName, programCode } = info
    if (!programName || !programCode) return

    const description = await this._generateDescription(programName, programCode)
    console.log(`📚 Skill description for ${programName}: ${description}`)

    let codeFileName = programName
    if (this.skills[programName]) {
      let i = 2
      while (fs.existsSync(path.join(skillCodeDir, `${programName}V${i}.js`))) i++
      codeFileName = `${programName}V${i}`
    }

    fs.writeFileSync(path.join(skillCodeDir, `${codeFileName}.js`), programCode)
    this.skills[programName] = {
      code: programCode,
      description,
      stats: this.skills[programName]?.stats || { attempts: 0, successes: 0 }
    }

    this._save()
    console.log(`📚 Saved skill: ${programName} (total: ${Object.keys(this.skills).length})`)
  }

  updateStats(skillName, success) {
    if (this.skills[skillName]) {
      this.skills[skillName].stats.attempts++
      if (success) this.skills[skillName].stats.successes++
      this._save()
    }
  }

  async retrieveSkills(query) {
    const k = Math.min(Object.keys(this.skills).length, config.skill?.retrievalTopK || 5)
    if (k === 0) return []

    // Simple keyword matching (no embeddings to save memory)
    const queryLower = query.toLowerCase()
    const matched = []
    for (const [name, skill] of Object.entries(this.skills)) {
      const text = `${name} ${skill.description}`.toLowerCase()
      const score = queryLower.split(/\s+/).filter(w => text.includes(w)).length
      if (score > 0) matched.push({ name, score })
    }
    matched.sort((a, b) => b.score - a.score)
    const topK = matched.slice(0, k)
    if (topK.length > 0) console.log(`📚 Retrieved skills: ${topK.map(s => s.name).join(', ')}`)
    return topK.map(s => this.skills[s.name].code)
  }

  get programs() {
    let programs = ''
    for (const [name, entry] of Object.entries(this.skills)) {
      programs += `${entry.code}\n\n`
    }
    return programs
  }

  get skillCount() { return Object.keys(this.skills).length }
}

let _instance = null
function getSkillManager() {
  if (!_instance) _instance = new SkillManager()
  return _instance
}

module.exports = { getSkillManager, SkillManager }
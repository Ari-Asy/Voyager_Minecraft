const fs = require('fs')
const path = require('path')
const config = require('../config')
const { ollamaGenerate } = require('./ollama_helper')

const stateDir = path.join(__dirname, '..', 'state')

class SkillManager {
  constructor(botName = 'bot1') {
    this.botName = botName
    this.skills = {}
    this.controlPrimitives = null
    this.skillsFile = path.join(stateDir, `skills_${botName}.json`)
    this.skillCodeDir = path.join(stateDir, `skill_code_${botName}`)
    this._loadControlPrimitives()
    this._load()
  }

  _loadControlPrimitives() {
    try {
      const p = path.join(__dirname, '..', 'skills', 'controlPrimitives.js')
      this.controlPrimitives = fs.readFileSync(p, 'utf8')
    } catch (e) {
      console.log('skillManager: could not load control primitives:', e.message)
      this.controlPrimitives = ''
    }
  }

  _load() {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
    if (!fs.existsSync(this.skillCodeDir)) fs.mkdirSync(this.skillCodeDir, { recursive: true })
    if (fs.existsSync(this.skillsFile)) {
      try {
        this.skills = JSON.parse(fs.readFileSync(this.skillsFile, 'utf8'))
        console.log(`[${this.botName}] Loaded ${Object.keys(this.skills).length} skills`)
      } catch (e) { this.skills = {} }
    }
  }

  _save() {
    fs.writeFileSync(this.skillsFile, JSON.stringify(this.skills, null, 2))
  }

  async _generateDescription(programName, programCode) {
    try {
      const response = await ollamaGenerate(config.ollama.endpoint, {
        model: config.ollama.planModel,
        prompt: `Describe what this Minecraft bot function does in one short sentence.\nFunction: ${programName}\n\n${programCode.substring(0, 400)}\n\nDescription:`
      })
      return response.trim().substring(0, 200) || `Function ${programName}`
    } catch (e) { return `Function ${programName}` }
  }

  async addSkill(info) {
    const { programName, programCode } = info
    if (!programName || !programCode) return

    const description = await this._generateDescription(programName, programCode)
    let codeFileName = programName
    if (this.skills[programName]) {
      let i = 2
      while (fs.existsSync(path.join(this.skillCodeDir, `${programName}V${i}.js`))) i++
      codeFileName = `${programName}V${i}`
    }
    fs.writeFileSync(path.join(this.skillCodeDir, `${codeFileName}.js`), programCode)
    this.skills[programName] = {
      code: programCode,
      description,
      stats: this.skills[programName]?.stats || { attempts: 0, successes: 0 }
    }
    this._save()
    console.log(`[${this.botName}] Saved skill: ${programName} (total: ${Object.keys(this.skills).length})`)
  }

  // รับ skill ที่ bot อีกตัวส่งมาผ่าน chat
  addSkillDirect(info) {
    const { programName, programCode } = info
    if (!programName || !programCode) return
    if (this.skills[programName]) return // มีอยู่แล้ว ไม่ทับ
    fs.writeFileSync(path.join(this.skillCodeDir, `${programName}.js`), programCode)
    this.skills[programName] = {
      code: programCode,
      description: `Shared skill from partner bot`,
      stats: { attempts: 0, successes: 0 }
    }
    this._save()
    console.log(`[${this.botName}] Received shared skill: ${programName}`)
  }

  async retrieveSkills(query) {
    const k = Math.min(Object.keys(this.skills).length, config.skill?.retrievalTopK || 5)
    if (k === 0) return []
    const queryLower = query.toLowerCase()
    const matched = []
    for (const [name, skill] of Object.entries(this.skills)) {
      const text = `${name} ${skill.description}`.toLowerCase()
      const score = queryLower.split(/\s+/).filter(w => text.includes(w)).length
      if (score > 0) matched.push({ name, score })
    }
    matched.sort((a, b) => b.score - a.score)
    return matched.slice(0, k).map(s => this.skills[s.name].code)
  }

  get skillCount() { return Object.keys(this.skills).length }
}

const _instances = {}
function getSkillManager(botName = 'bot1') {
  if (!_instances[botName]) _instances[botName] = new SkillManager(botName)
  return _instances[botName]
}

module.exports = { getSkillManager, SkillManager }
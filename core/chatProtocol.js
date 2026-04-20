const { getSkillManager } = require('./skillManager')
const config = require('../config')

const CHUNK_SIZE = 180 // safe payload per message (under 256 chat limit)

function getChunkDelay() { return config.chat?.chunkDelay || 600 }

// ─── Buffers for reassembling incoming skill chunks ───
const _chunkBuffers = {} // { skillName: { total, chunks: {0: '...', 1: '...'} } }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── SEND functions ───

/**
 * Send a skill to the other bot via chunked chat messages.
 * Format: §SKILL:<name>:<i>/<n>:<data>
 */
async function sendSkill(bot, skillName, skillCode) {
  const chunks = []
  for (let i = 0; i < skillCode.length; i += CHUNK_SIZE) {
    chunks.push(skillCode.substring(i, i + CHUNK_SIZE))
  }

  // Announce in natural language first
  if (config.chat?.naturalLanguage !== false) {
    const partnerName = getPartnerName(bot.username)
    bot.chat(`Hey ${partnerName}! I just learned a new skill: ${skillName} 🎉`)
    await sleep(getChunkDelay())
  }

  // Send chunks
  for (let i = 0; i < chunks.length; i++) {
    bot.chat(`§SKILL:${skillName}:${i + 1}/${chunks.length}:${chunks[i]}`)
    await sleep(getChunkDelay())
  }

  console.log(`[${bot.username}] Sent skill ${skillName} in ${chunks.length} chunks`)
}

/**
 * Send acknowledgment that a skill was received.
 */
function sendAck(bot, skillName) {
  bot.chat(`§ACK:${skillName}`)
  if (config.chat?.naturalLanguage !== false) {
    setTimeout(() => {
      const partnerName = getPartnerName(bot.username)
      bot.chat(`Thanks ${partnerName}! I received ${skillName} and added it to my library 📚`)
    }, getChunkDelay())
  }
}

/**
 * Request a skill from the partner bot.
 */
function requestSkill(bot, query) {
  bot.chat(`§REQ:${query}`)
}

/**
 * Share current progress status.
 */
function sendStatus(bot, memory) {
  const completed = memory.completedTasks?.length || 0
  const skills = memory.skillCount || 0
  bot.chat(`§STATUS:completed ${completed} tasks | skills: ${skills}`)
}

/**
 * Get the partner bot's username.
 */
function getPartnerName(myUsername) {
  if (myUsername === config.bot1.username) return config.bot2.username
  return config.bot1.username
}

// ─── RECEIVE: chat listener ───

/**
 * Setup the chat listener for receiving skills, acks, requests, and status.
 * Call this once in bot.js / bot2.js on spawn.
 */
function setupChatListener(bot, memory, botName) {
  const skillManager = getSkillManager(botName)
  const tag = `[${botName}]`

  bot.on('chat', (username, message) => {
    // Ignore own messages
    if (username === bot.username) return

    // ─── §SKILL: chunk received ───
    if (message.startsWith('§SKILL:')) {
      handleSkillChunk(message, username, bot, skillManager, tag)
      return
    }

    // ─── §ACK: partner confirmed receipt ───
    if (message.startsWith('§ACK:')) {
      const skillName = message.slice(5)
      console.log(`${tag} Partner ${username} acknowledged: ${skillName}`)
      return
    }

    // ─── §REQ: partner is requesting a skill ───
    if (message.startsWith('§REQ:')) {
      const query = message.slice(5)
      handleSkillRequest(bot, skillManager, query, tag)
      return
    }

    // ─── §STATUS: partner sharing progress ───
    if (message.startsWith('§STATUS:')) {
      const status = message.slice(8)
      console.log(`${tag} Partner ${username} status: ${status}`)
      return
    }
  })

  // Greet partner on connect
  if (config.chat?.naturalLanguage !== false) {
    setTimeout(() => {
      const partnerName = getPartnerName(bot.username)
      bot.chat(`Hello ${partnerName}! I'm ${bot.username}, ready to learn together! 🤝`)
    }, 3000)
  }

  console.log(`${tag} Chat protocol listener active`)
}

/**
 * Handle an incoming §SKILL: chunk message.
 * Buffers chunks and reassembles when complete.
 */
function handleSkillChunk(message, sender, bot, skillManager, tag) {
  // Parse: §SKILL:<name>:<i>/<n>:<data>
  const withoutPrefix = message.slice(7) // remove '§SKILL:'
  const firstColon = withoutPrefix.indexOf(':')
  const secondColon = withoutPrefix.indexOf(':', firstColon + 1)

  if (firstColon === -1 || secondColon === -1) return

  const skillName = withoutPrefix.substring(0, firstColon)
  const indexPart = withoutPrefix.substring(firstColon + 1, secondColon)
  const data = withoutPrefix.substring(secondColon + 1)

  const [chunkStr, totalStr] = indexPart.split('/')
  const chunkIndex = parseInt(chunkStr) - 1 // 0-based
  const totalChunks = parseInt(totalStr)

  if (isNaN(chunkIndex) || isNaN(totalChunks)) return

  // Initialize buffer for this skill
  if (!_chunkBuffers[skillName]) {
    _chunkBuffers[skillName] = { total: totalChunks, chunks: {}, sender }
  }

  const buffer = _chunkBuffers[skillName]
  buffer.chunks[chunkIndex] = data

  console.log(`${tag} Received chunk ${chunkIndex + 1}/${totalChunks} for ${skillName}`)

  // Check if all chunks arrived
  const receivedCount = Object.keys(buffer.chunks).length
  if (receivedCount >= buffer.total) {
    // Reassemble
    let fullCode = ''
    for (let i = 0; i < buffer.total; i++) {
      fullCode += buffer.chunks[i] || ''
    }

    // Clean up buffer
    delete _chunkBuffers[skillName]

    // Skip if we already have this skill
    if (skillManager.hasSkill(skillName)) {
      console.log(`${tag} Already have skill ${skillName}, skipping`)
      return
    }

    // Add to skill library
    skillManager.addSkillDirect({
      programName: skillName,
      programCode: fullCode
    })

    console.log(`${tag} ✅ Assembled and saved shared skill: ${skillName}`)

    // Send acknowledgment
    sendAck(bot, skillName)
  }
}

/**
 * Handle a §REQ: skill request from partner.
 * Searches own library and sends matching skill if found.
 */
async function handleSkillRequest(bot, skillManager, query, tag) {
  console.log(`${tag} Partner requested skill for: "${query}"`)

  const codes = await skillManager.retrieveSkills(query)
  if (codes.length === 0) {
    bot.chat(`Sorry, I don't have a skill for "${query}" yet 🤔`)
    return
  }

  // Send the best matching skill
  const bestCode = codes[0]
  const funcMatch = bestCode.match(/async\s+function\s+(\w+)\s*\(\s*bot\s*\)/)
  if (funcMatch) {
    const skillName = funcMatch[1]
    bot.chat(`I have a skill for that! Sending ${skillName}...`)
    await sleep(getChunkDelay())
    await sendSkill(bot, skillName, bestCode)
  }
}

module.exports = {
  sendSkill,
  sendAck,
  requestSkill,
  sendStatus,
  setupChatListener
}

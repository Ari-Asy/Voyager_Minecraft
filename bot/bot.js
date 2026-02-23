const mineflayer = require('mineflayer')
const axios = require('axios')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

// --- Config ---
const args = process.argv.slice(2)
const AGENT_NAME = args[0] || 'AI_Tester' // ชื่อบอทสำหรับเทส
const BOT_PORT = parseInt(args[1]) || 25565
const SERVER_URL = 'http://localhost:5000'

console.log(`🚀 Starting Single Agent Test: ${AGENT_NAME}`)

const bot = mineflayer.createBot({
    host: 'localhost',
    port: BOT_PORT,
    username: AGENT_NAME
})

bot.loadPlugin(pathfinder)

// --- 1. Perception (ตา) ---
function getSight() {
    // 1. หาบล็อกที่ใกล้ที่สุด (เช่น ไม้, หิน)
    const blocks = bot.findBlocks({
        matching: (block) => ['oak_log', 'birch_log', 'stone', 'coal_ore'].includes(block.name),
        maxDistance: 10,
        count: 5
    })
    const nearbyBlocks = blocks.map(pos => bot.blockAt(pos).name)

    // 2. หาสิ่งมีชีวิต (Entities) เช่น หมู, ซอมบี้
    const entities = Object.values(bot.entities)
        .filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 10)
        .map(e => e.name)

    return {
        blocks: [...new Set(nearbyBlocks)], // ลบชื่อซ้ำ
        entities: [...new Set(entities)]
    }
}

// --- 2. Action (มือ) ---
async function performAction(instruction) {
    console.log(`🤖 Action: ${instruction.command}`)

    if (instruction.command === 'mine') {
        const blockType = instruction.target || 'log'
        const block = bot.findBlock({
            matching: b => b.name.includes(blockType),
            maxDistance: 10
        })

        if (block) {
            const mcData = require('minecraft-data')(bot.version)
            const movements = new Movements(bot, mcData)
            bot.pathfinder.setMovements(movements)

            try {
                await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z))
                await bot.dig(block)
                return "mining_success"
            } catch (e) {
                return "move_failed"
            }
        } else {
            return "block_not_found"
        }
    }

    if (instruction.command === 'chat') {
        bot.chat(instruction.message)
        return "chatted"
    }

    if (instruction.command === 'wander') {
        bot.setControlState('forward', true)
        if (Math.random() > 0.5) bot.setControlState('jump', true)
        await new Promise(r => setTimeout(r, 1000))
        bot.clearControlStates()
        return "wandered"
    }

    return "idle"
}

// --- 3. Main Loop ---
let isProcessing = false

async function aiLoop() {
    if (isProcessing) return
    isProcessing = true

    try {
        // 1. รวบรวมข้อมูล
        const sight = getSight()
        const state = {
            agent_id: AGENT_NAME,
            health: bot.health,
            food: bot.food,
            inventory: bot.inventory.items().map(i => i.name),
            nearby: sight
        }

        console.log("📤 Sending state to brain...")

        // 2. ส่งไปถาม Server (Python)
        const response = await axios.post(`${SERVER_URL}/decide`, state)
        const instruction = response.data // { command: "mine", target: "oak_log" }

        // 3. ทำตามคำสั่ง
        const result = await performAction(instruction)

        // 4. บันทึกผล
        await axios.post(`${SERVER_URL}/log/action`, {
            agent_id: AGENT_NAME,
            action_type: instruction.command,
            result: result
        })

    } catch (err) {
        console.log("❌ Error:", err.message)
    } finally {
        isProcessing = false
    }
}

bot.once('spawn', () => {
    console.log('✅ Bot Spawned! Loop starting...')
    setInterval(aiLoop, 5000) // คิดทุกๆ 5 วินาที
})
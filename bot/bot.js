const mineflayer = require('mineflayer')
const axios = require('axios')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcData = require('minecraft-data')

const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'AI_1'
})

// --- Plugins & Config ---
bot.loadPlugin(pathfinder)

// --- API Logging Helpers ---
const API_URL = 'http://localhost:5000/log'

const logger = {
    action: (type, target = null, result = "success") => {
        axios.post(`${API_URL}/action`, {
            agent_id: bot.username,
            action_type: type,
            target,
            result,
            duration: null,
            error_message: null
        }).catch(() => { }); // เงียบไว้ถ้า Server log ปิดอยู่
    },
    state: (task) => {
        if (!bot.entity) return
        axios.post(`${API_URL}/state`, {
            agent_id: bot.username,
            position: [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z],
            health: bot.health,
            hunger: bot.food,
            inventory: bot.inventory.items().map(i => i.name),
            current_task: task
        }).catch(() => { });
    }
}

// ฟังก์ชันสุ่มเดิน
async function randomWalk() {

    const directions = [
        { x: 5, z: 0 },
        { x: -5, z: 0 },
        { x: 0, z: 5 },
        { x: 0, z: -5 }
    ]

    const choice = directions[Math.floor(Math.random() * directions.length)]

    const x = bot.entity.position.x + choice.x
    const y = bot.entity.position.y
    const z = bot.entity.position.z + choice.z

    console.log("🔍 สำรวจไปที่:", x, y, z)

    try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1))
    } catch (err) {
        if (err.name !== 'GoalChanged') {
            console.log("Pathfinding error:", err.message)
        }
    }
}

// --- Helper: ฟังก์ชันนับจำนวนไอเทมในตัวบอท ---
function countItem(itemName) {
    // กรองไอเทมในช่องเก็บของที่มีชื่อตรงกับที่ระบุ และรวมจำนวน (count)
    return bot.inventory.items()
        .filter(item => item.name.includes(itemName) || itemName.includes(item.name))
        .reduce((total, item) => total + item.count, 0)
}

async function startMining(block) {
    try {
        skillMemory.mine_log.attempts++
        // เก็บจำนวนของก่อนขุด
        const beforeCount = countLogs()
        // กำหนดค่าการเคลื่อนที่
        const mcDataInstance = mcData(bot.version)
        const movements = new Movements(bot, mcDataInstance)
        bot.pathfinder.setMovements(movements)
        // เดินไปหาเป้าหมาย
        await bot.pathfinder.goto(
            new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1)
        )
        // ขุด
        await bot.dig(block)
        // รอของตกพื้นและบอทเดินไปดูดไอเทม (Delay เล็กน้อย)
        await new Promise(r => setTimeout(r, 800))
        // เก็บจำนวนของหลังขุด
        const afterCount = countLogs()
        // เช็คว่าขุดสำเร็จหรือไม่
        if (afterCount > beforeCount) {
            skillMemory.mine_log.success++
            updateSkill("mine_log", "success")
            logger.action("mine_success", block.name)
        } else {
            skillMemory.mine_log.fail++
            updateSkill("mine_log", "fail")
            logger.action("mine_no_drop", block.name, "fail")
        }
        // กรณีเกิดข้อผิดพลาด
    } catch (err) {
        skillMemory.mine_log.fail++
        updateSkill("mine_log", "fail")
        logger.action("mine_error", block.name, "fail")
    }
}

// ฟังก์ชันตรวจสอบว่าควรขุดหรือไม่
function shouldMine() {
    const skill = skillMemory.mine_log // เก็บข้อมูลทักษะการขุดไม้
    const rate = skill.success / (skill.attempts || 1) // ป้องกันหารด้วย 0
    console.log("DEBUG mine rate:", rate) // แสดงค่าความแม่นยำ
    if (skill.attempts < 5) return true  // ยังไม่มีข้อมูลพอ
    return rate > 0.4 // ถ้าความแม่นยำมากกว่า 0.4 ให้ขุด
}

// --- Events ---
bot.once('spawn', () => {
    console.log('🤖 บอทออนไลน์และเริ่มระบบ AI')

    const mcDataInstance = mcData(bot.version)
    const movements = new Movements(bot, mcDataInstance)

    // ปรับพฤติกรรมการเดิน
    movements.canDig = true          // ไม่ขุดบล็อกระหว่างเดิน
    movements.allow1by1towers = false // ไม่ต่อเสาสุ่ม
    movements.maxDropDown = 1         // ห้ามตกสูงเกิน 1 บล็อก

    bot.pathfinder.setMovements(movements)

    setInterval(aiLoop, 5000)
})

// --- Movement Logic ---
let isBusy = false

let lastPosition = null

let stuckTicks = 0

// --- Main AI Loop ---
async function aiLoop() {
    if (isBusy) return
    isBusy = true
    // ตรวจสอบเป้าหมายปัจจุบัน
    try {

        // --- STUCK DETECTION ---
        if (bot.entity) {

            const currentPos = bot.entity.position.clone()

            if (lastPosition) {
                const distance = currentPos.distanceTo(lastPosition)

                if (distance < 0.2) {
                    stuckTicks++
                } else {
                    stuckTicks = 0
                }
            }

            lastPosition = currentPos

            if (stuckTicks > 3) {
                console.log("⚠️ Bot stuck! Resetting path...")
                bot.pathfinder.setGoal(null)
                stuckTicks = 0
                isBusy = false
                return
            }
        }

        // --- NORMAL AI LOGIC ---
        const goal = getCurrentGoal()
        // ถ้าเป้าหมายคือเก็บไม้
        if (goal === "collect_wood") {
            // ค้นหาไม้ในระยะ 16 บล็อก
            const block = bot.findBlock({
                matching: b => b.name.includes('_log') || b.name.includes('stem'),
                maxDistance: 16
            })
            // ถ้าพบไม้
            if (block) {
                await startMining(block)
            } else {
                await randomWalk() // await ให้การเดินเสร็จสิ้นก่อน
                updateSkill("explore", "success")
            }
            // ถ้าเป้าหมายคือสำรวจ
        } else {
            await randomWalk() // await ให้การเดินเสร็จสิ้นก่อน
        }

        logger.state(goal)

    } catch (err) {
        console.log("⚠️ Loop Error:", err.message)
    } finally {
        isBusy = false
    }
}

// เมื่อบอทตาย
bot.on('death', () => {
    console.log('💀 บอทตาย!')
    logger.action("death", null, "fail")
    isBusy = false
})

// เมื่อบอทเกิดข้อผิดพลาด
bot.on('error', (err) => console.log('Critical Error:', err))

// กำหนดเป้าหมาย
const GOAL = {
    targetWood: 20
}

// เก็บข้อมูลทักษะ
const fs = require('fs')

const MEMORY_FILE = './skill_memory.json'

let skillMemory = loadMemory()

function loadMemory() {
    if (fs.existsSync(MEMORY_FILE)) {
        return JSON.parse(fs.readFileSync(MEMORY_FILE))
    }
    return {
        mine_log: { attempts: 0, success: 0, fail: 0 },
        explore: { attempts: 0, success: 0, fail: 0 }
    }
}

function saveMemory() {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(skillMemory, null, 2))
}

// อัปเดตข้อมูลทักษะ
function updateSkill(skill, result) {
    skillMemory[skill].attempts++
    skillMemory[skill][result]++

    const rate = skillMemory[skill].success / skillMemory[skill].attempts

    console.log(`📊 ${skill} success rate: ${rate.toFixed(2)}`)

    saveMemory()
}

// นับจำนวนไม้
function countLogs() {
    return bot.inventory.items()
        .filter(i => i.name.includes('_log') || i.name.includes('stem'))
        .reduce((sum, item) => sum + item.count, 0)
}

// ตรวจสอบเป้าหมายปัจจุบัน
function getCurrentGoal() {
    const woodCount = countLogs()

    if (woodCount < GOAL.targetWood) {
        return "collect_wood"
    }

    return "explore"
}
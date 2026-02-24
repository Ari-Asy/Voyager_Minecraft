const mineflayer = require('mineflayer')
const axios = require('axios')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { Vec3 } = require('vec3')

const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'AI_BASELINE'
})

bot.loadPlugin(pathfinder)

const API_URL = 'http://localhost:5000'

let mcData
let defaultMovements
let lastPos = null
let stuckTicks = 0
let isBusy = false
let stage = 'idle'
let stageStartTime = Date.now()

// ---------------- INIT ----------------

bot.once('spawn', async () => {
    console.log("✅ Bot spawned")

    mcData = mcDataLoader(bot.version)

    defaultMovements = new Movements(bot, mcData)
    defaultMovements.canDig = true
    defaultMovements.allow1by1towers = false
    defaultMovements.allowFreeMotion = false
    defaultMovements.maxDropDown = 1

    // 🔧 เพิ่ม — ให้ขุด block ขวางทางได้ระหว่างเดิน
    defaultMovements.digCost = 2        // ยอมขุดถ้าจำเป็น
    defaultMovements.placeCost = 999    // ไม่วาง block ระหว่างเดิน

    // บล็อคที่ไม่ต้องขุดทิ้ง (เดินผ่านได้เลย)
    defaultMovements.blocksToAvoid = new Set([
        mcData.blocksByName.lava?.id,
        mcData.blocksByName.fire?.id,
    ].filter(Boolean))

    bot.pathfinder.setMovements(defaultMovements)

    mainLoop()
})

// ---------------- LOOP ----------------

async function mainLoop() {
    while (true) {
        try {
            await aiLoop()
        } catch (err) {
            console.log("Loop Error:", err.message)
        }
        await bot.waitForTicks(10)
    }
}

// ---------------- DEBUG ----------------

bot.on('diggingCompleted', (block) => {
    console.log("✅ Dig completed:", block.name)
})

bot.on('diggingAborted', (block) => {
    console.log("❌ Dig aborted:", block.name)
})

// ---------------- UTIL ----------------

function countItem(name) {
    return bot.inventory.items()
        .filter(i => i.name.includes(name))
        .reduce((sum, i) => sum + i.count, 0)
}

async function moveNear(pos, timeout = 15000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            bot.pathfinder.setGoal(null)
            console.log("⏰ moveNear timeout, giving up")
            resolve(false)
        }, timeout)

        bot.pathfinder.goto(
            new goals.GoalNear(pos.x, pos.y, pos.z, 1)
        ).then(() => {
            clearTimeout(timer)
            resolve(true)
        }).catch(() => {
            clearTimeout(timer)
            resolve(false)
        })
    })
}

async function equipBestTool(block) {
    const tool = bot.pathfinder.bestHarvestTool(block)
    if (tool) {
        try { await bot.equip(tool, 'hand') } catch { }
    }
}

async function safeDig(block, maxRetries = 3) {
    if (!block || block.type === 0) return false

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

        const fresh = bot.blockAt(block.position)
        if (!fresh || fresh.type === 0) {
            console.log("✅ Already air")
            return true
        }

        if (!bot.canDigBlock(fresh)) {
            console.log("❌ Cannot dig:", fresh.name)
            return false
        }

        await equipBestTool(fresh)

        try {
            await bot.dig(fresh)
        } catch (err) {
            console.log("❌ dig threw:", err.message)
        }

        // 🔥 รอ server update จริง ๆ
        await bot.waitForTicks(5)

        const verify = bot.blockAt(block.position)

        if (!verify || verify.type === 0) {
            console.log("✅ Dig confirmed by world state")
            return true
        }

        console.log("⚠️ Block still exists, retrying...")
        await bot.waitForTicks(10)
    }

    console.log("❌ Dig failed after retries")
    return false
}

async function unstuck() {
    console.log("⚠️ Stuck! Trying to escape...")

    bot.pathfinder.setGoal(null)
    bot.clearControlStates()

    // ลอง jump + เดินถอยหลัง
    bot.setControlState('jump', true)
    bot.setControlState('back', true)
    await bot.waitForTicks(8)
    bot.setControlState('jump', false)
    bot.setControlState('back', false)

    // หมุนหันไปทิศสุ่ม แล้วเดินหน้าสั้นๆ
    const yaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI
    bot.entity.yaw = yaw
    bot.setControlState('forward', true)
    await bot.waitForTicks(6)
    bot.setControlState('forward', false)

    // refresh movements
    bot.pathfinder.setMovements(defaultMovements)

    stuckTicks = 0
}

async function findOrPlaceCraftingTable() {
    let tableBlock = bot.findBlock({
        matching: mcData.blocksByName.crafting_table.id,
        maxDistance: 32
    })
    if (tableBlock) {
        await moveNear(tableBlock.position)
        return tableBlock
    }

    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table')
    if (!tableItem) {
        console.log("❌ No crafting_table in inventory to place")
        return null
    }

    const botPos = bot.entity.position.floored()

    const candidates = [
        botPos.offset(1, 0, 0),
        botPos.offset(-1, 0, 0),
        botPos.offset(0, 0, 1),
        botPos.offset(0, 0, -1),
    ]

    let placed = false
    for (const pos of candidates) {
        const below = bot.blockAt(pos.offset(0, -1, 0))
        const target = bot.blockAt(pos)

        if (!below || below.type === 0) continue
        if (target && target.type !== 0) continue

        try {
            await bot.equip(tableItem, 'hand')
            await bot.placeBlock(below, new Vec3(0, 1, 0))
            await bot.waitForTicks(5)
            console.log("📦 Placed crafting table at", pos)
            placed = true
            break
        } catch (err) {
            console.log("❌ Place error at", pos, ":", err.message)
        }
    }

    if (!placed) {
        console.log("❌ Could not find a valid spot to place crafting table")
        return null
    }

    return bot.findBlock({
        matching: mcData.blocksByName.crafting_table.id,
        maxDistance: 5
    })
}

// ---------------- ACTIONS ----------------

async function collectWood() {

    const block = bot.findBlock({
        matching: b => b.name.includes('_log'),
        maxDistance: 32
    })

    if (!block) {
        console.log("🌳 No wood nearby, exploring...")
        await explore()
        return false
    }

    await moveNear(block.position)

    return await safeDig(block)
}

async function craftItem(itemName, amount = 1) {
    // 🔒 Guard: ใช้ bot.registry แทน mcData เพื่อความแม่นยำ
    const item = bot.registry.itemsByName[itemName]
    if (!item) {
        console.log("❌ Item not found:", itemName)
        return false
    }

    console.log(`🔍 Item ID for ${itemName}:`, item.id)
    console.log("🎒 Inventory:", bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', '))

    // 🔒 Guard: เช็ค recipe null เสมอ
    let recipes = bot.recipesFor(item.id, null, 1, bot.inventory)
    if (!recipes || recipes.length === 0) {
        console.log("📋 No 2x2 recipe, trying with crafting table...")
        recipes = []
    } else {
        console.log(`� 2x2 recipes found:`, recipes.length)
    }

    let craftingTable = null

    if (recipes.length === 0) {
        craftingTable = await findOrPlaceCraftingTable()

        if (craftingTable) {
            console.log("🪵 Crafting table found at:", craftingTable.position)

            const allRecipes = bot.recipesAll(item.id, null, craftingTable)
            console.log(`📋 recipesAll found:`, allRecipes.length)

            // 🔒 Guard: filter เฉพาะ recipe ที่มี ingredient ครบ
            recipes = allRecipes.filter(recipe => {
                return recipe.delta.every(delta => {
                    if (delta.count >= 0) return true
                    const needed = mcData.items[delta.id]
                    if (!needed) return false
                    const have = countItem(needed.name)
                    return have >= Math.abs(delta.count)
                })
            })

            console.log(`✅ Matching recipes (has ingredients):`, recipes.length)
        } else {
            console.log("❌ No crafting table available")
        }
    }

    // 🔒 Guard: final null/empty check
    if (!recipes || recipes.length === 0) {
        console.log("❌ No recipe for:", itemName, "(ingredient ไม่ครบ)")
        return false
    }

    try {
        await bot.craft(recipes[0], amount, craftingTable)
        console.log("🛠 Crafted:", itemName)
        return true
    } catch (err) {
        console.log("❌ Craft error:", err.message)
        return false
    }
}

async function clearPathTo(targetPos) {
    // ดูบล็อคที่อยู่ระหว่าง bot กับเป้าหมาย (ระดับเท้า + ระดับหัว)
    const botPos = bot.entity.position.floored()
    const dx = Math.sign(targetPos.x - botPos.x)
    const dz = Math.sign(targetPos.z - botPos.z)

    const toCheck = [
        botPos.offset(dx, 0, dz),
        botPos.offset(dx, 1, dz),
        botPos.offset(dx, 0, 0),
        botPos.offset(0, 0, dz),
        botPos.offset(dx, 1, 0),
        botPos.offset(0, 1, dz),
    ]

    for (const pos of toCheck) {
        const block = bot.blockAt(pos)
        if (!block || block.type === 0) continue
        if (block.name === 'air' || block.name === 'cave_air') continue

        // ถ้าเป็นบล็อคที่ขวางทาง (ดิน หญ้า ดอกไม้ ฯลฯ) ให้ขุดทิ้ง
        console.log(`🧱 Clearing obstacle: ${block.name} at ${pos}`)
        await safeDig(block)
    }
}

async function mineStone() {
    const block = bot.findBlock({
        matching: mcData.blocksByName.stone.id,
        maxDistance: 32
    })

    if (!block) return false

    // ขุดสิ่งขวางทางก่อนเดิน
    await clearPathTo(block.position)

    // เดินไปหาหิน โดยให้ pathfinder ขุดได้ระหว่างทาง
    defaultMovements.canDig = true
    bot.pathfinder.setMovements(defaultMovements)

    const moved = await moveNear(block.position)
    if (!moved) {
        console.log("❌ Cannot reach stone, trying to clear more...")
        await clearPathTo(block.position)
        await moveNear(block.position)
    }

    // ขุดหินที่เป้าหมาย
    const freshBlock = bot.blockAt(block.position)
    if (!freshBlock || freshBlock.type === 0) return false

    return await safeDig(freshBlock)
}

async function explore() {

    const randomX = bot.entity.position.x + (Math.random() - 0.5) * 20
    const randomZ = bot.entity.position.z + (Math.random() - 0.5) * 20
    const y = bot.entity.position.y

    const goal = new goals.GoalNear(randomX, y, randomZ, 2)

    console.log("🔍 Exploring new area...")

    try {
        await bot.pathfinder.goto(goal)
    } catch { }
}

// ---------------- AI LOGIC ----------------

async function aiLoop() {
    console.log("🧠 AI Loop Tick | Stage:", stage)

    // ⏰ Stage timeout — ถ้า stage ใดใช้เวลานานเกิน 20 วิ ให้ reset
    if (stageTimeoutExceeded()) {
        console.log("⚠️ Stage timeout, resetting...")
        setStage('idle')
    }

    // ---- stuck detection ----
    if (bot.entity) {
        const pos = bot.entity.position.clone()

        if (lastPos && pos.distanceTo(lastPos) < 0.2) {
            stuckTicks++
        } else {
            stuckTicks = 0
        }

        lastPos = pos

        if (stuckTicks > 8) {
            await unstuck()
        }
    }

    if (isBusy) return
    isBusy = true

    try {

        // 🌳 Collect Wood
        if (countItem('oak_log') < 3) {
            setStage('collect_wood')
            console.log("Stage: Collect Wood")
            await collectWood()
            return
        }

        // 🪵 Craft Planks
        if (countItem('oak_planks') < 4) {
            setStage('craft_planks')
            console.log("Stage: Craft Planks")
            await craftItem('oak_planks', 4)
            return
        }

        // 🛠 Craft Table
        if (countItem('crafting_table') < 1) {
            setStage('craft_table')
            console.log("Stage: Craft Table")
            await craftItem('crafting_table', 1)
            return
        }

        // ⛏ Craft Wooden Pickaxe
        if (countItem('wooden_pickaxe') < 1) {

            // craft stick ก่อนถ้ายังไม่มี
            if (countItem('stick') < 2) {
                setStage('craft_sticks')
                console.log("Stage: Craft Sticks")
                await craftItem('stick', 4)
                return
            }

            setStage('craft_wooden_pickaxe')
            console.log("Stage: Craft Wooden Pickaxe")
            await craftItem('wooden_pickaxe', 1)
            return
        }

        // 🪨 Mine Stone
        if (countItem('cobblestone') < 3) {
            setStage('mine_stone')
            console.log("Stage: Mine Stone")
            await mineStone()
            return
        }

        // ⛏ Craft Stone Pickaxe
        if (countItem('stone_pickaxe') < 1) {
            setStage('craft_stone_pickaxe')
            console.log("Stage: Craft Stone Pickaxe")
            await craftItem('stone_pickaxe', 1)
            return
        }

        // 🪨 Stone Age Complete
        if (countItem('iron_pickaxe') >= 1) {
            console.log("⛓ Iron Age Complete")
            return
        }

        // ⛏ Mine Iron Ore
        if (countItem('raw_iron') < 3) {
            console.log("Stage: Mine Iron Ore")
            await mineIron()
            return
        }

        // 🔥 Smelt Iron
        if (countItem('iron_ingot') < 3) {
            console.log("Stage: Smelt Iron")
            await smeltIron()
            return
        }

        // ⛏ Craft Iron Pickaxe
        if (countItem('iron_pickaxe') < 1) {
            console.log("Stage: Craft Iron Pickaxe")
            await craftItem('iron_pickaxe', 1)
            return
        }

    } finally {
        isBusy = false
    }
}

// ---------------- STAGE MANAGEMENT ----------------

function setStage(newStage) {
    if (stage !== newStage) {
        console.log(`🔄 Stage: ${stage} → ${newStage}`)
    }
    stage = newStage
    stageStartTime = Date.now()
}

function stageTimeoutExceeded() {
    return stage !== 'idle' && stage !== 'complete' && (Date.now() - stageStartTime > 20000)
}
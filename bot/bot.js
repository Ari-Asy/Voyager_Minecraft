const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { Vec3 } = require('vec3')

const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'AI_BASELINE'
})

bot.loadPlugin(pathfinder)

let mcData
let defaultMovements
let lastPos = null
let stuckTicks = 0
let isBusy = false
let noDigMovements

// ---------------- INIT ----------------

bot.once('spawn', async () => {
    console.log("✅ Bot spawned")

    mcData = mcDataLoader(bot.version)

    defaultMovements = new Movements(bot, mcData)
    defaultMovements.canDig = true
    defaultMovements.allow1by1towers = false
    defaultMovements.allowFreeMotion = false
    defaultMovements.maxDropDown = 1
    defaultMovements.digCost = 2
    defaultMovements.placeCost = 999

    noDigMovements = new Movements(bot, mcData)
    noDigMovements.canDig = false
    noDigMovements.placeCost = 999
    noDigMovements.maxDropDown = 1

    noDigMovements.blocksCantBreak = new Set([
        mcData.blocksByName.stone?.id,
        mcData.blocksByName.cobblestone?.id,
        mcData.blocksByName.deepslate?.id,
        mcData.blocksByName.granite?.id,
        mcData.blocksByName.diorite?.id,
        mcData.blocksByName.andesite?.id,
        mcData.blocksByName.oak_log?.id,
        mcData.blocksByName.birch_log?.id,
        mcData.blocksByName.spruce_log?.id,
        mcData.blocksByName.jungle_log?.id,
        mcData.blocksByName.acacia_log?.id,
        mcData.blocksByName.dark_oak_log?.id,
        mcData.blocksByName.cherry_log?.id,
        mcData.blocksByName.mangrove_log?.id,
        mcData.blocksByName.coal_ore?.id,
        mcData.blocksByName.iron_ore?.id,
        mcData.blocksByName.deepslate_iron_ore?.id,
        mcData.blocksByName.deepslate_coal_ore?.id,
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

// ---------------- UTIL ----------------

function countItem(name) {
    return bot.inventory.items()
        .filter(i => i.name.includes(name))
        .reduce((sum, i) => sum + i.count, 0)
}

function hasItem(name) {
    return countItem(name) > 0
}

// ✅ นับ log ทุกชนิด
function countLogs() {
    const logTypes = [
        'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
        'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'
    ]
    return logTypes.reduce((sum, l) => sum + countItem(l), 0)
}

// ✅ นับ planks ทุกชนิด
function countPlanks() {
    const plankTypes = [
        'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
        'acacia_planks', 'dark_oak_planks', 'cherry_planks', 'mangrove_planks'
    ]
    return plankTypes.reduce((sum, p) => sum + countItem(p), 0)
}

async function moveNear(pos, timeout = 15000, allowDig = false) {
    bot.pathfinder.setMovements(allowDig ? defaultMovements : noDigMovements)

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            bot.pathfinder.setGoal(null)
            bot.pathfinder.setMovements(defaultMovements)
            resolve(false)
        }, timeout)

        bot.pathfinder.goto(
            new goals.GoalNear(pos.x, pos.y, pos.z, 1)
        ).then(() => {
            clearTimeout(timer)
            bot.pathfinder.setMovements(defaultMovements)
            resolve(true)
        }).catch(() => {
            clearTimeout(timer)
            bot.pathfinder.setMovements(defaultMovements)
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
    if (!block || block.type === 0 || block.name === 'air') return false

    const dist = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5))
    if (dist > 4) {
        await bot.pathfinder.goto(
            new goals.GoalNear(
                block.position.x,
                block.position.y,
                block.position.z,
                1
            )
        )
        await bot.waitForTicks(5)
    }

    const freshBlock = bot.blockAt(block.position)
    if (!freshBlock || freshBlock.type === 0) return true
    if (!bot.canDigBlock(freshBlock)) return false

    await equipBestTool(freshBlock)
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    await bot.waitForTicks(5)

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const target = bot.blockAt(block.position)
        if (!target || target.type === 0) return true

        const hardness = target.hardness ?? 1
        const digTimeout = Math.max(8000, hardness * 6000)

        const digPromise = new Promise((resolve) => {
            const onDone = (b) => {
                if (b.position.equals(target.position)) {
                    bot.removeListener('diggingAborted', onAbort)
                    resolve(true)
                }
            }
            const onAbort = (b) => {
                if (b.position.equals(target.position)) {
                    bot.removeListener('diggingCompleted', onDone)
                    resolve(false)
                }
            }
            bot.on('diggingCompleted', onDone)
            bot.on('diggingAborted', onAbort)
            setTimeout(() => {
                bot.removeListener('diggingCompleted', onDone)
                bot.removeListener('diggingAborted', onAbort)
                resolve(false)
            }, digTimeout)
        })

        const fresh = bot.blockAt(block.position)
        if (!fresh || fresh.type === 0) return true

        if (!bot.canSeeBlock(fresh)) {
            console.log("🚧 Block not visible, clearing obstacle...")
            await clearPathTo(fresh.position)
            return false
        }

        await bot.dig(fresh)

        const success = await digPromise
        if (success) {
            await bot.waitForTicks(3)
            bot.pathfinder.setMovements(defaultMovements)
            return true
        }

        await bot.waitForTicks(10)
        if (attempt > 1) await moveNear(block.position)
    }

    return false
}

async function unstuck() {
    console.log("⚠️ Stuck! Trying to escape...")
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()

    bot.setControlState('jump', true)
    bot.setControlState('back', true)
    await bot.waitForTicks(8)
    bot.setControlState('jump', false)
    bot.setControlState('back', false)

    const yaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI
    bot.entity.yaw = yaw
    bot.setControlState('forward', true)
    await bot.waitForTicks(6)
    bot.setControlState('forward', false)

    bot.pathfinder.setMovements(defaultMovements)
    stuckTicks = 0
}

async function explore() {
    const randomX = bot.entity.position.x + (Math.random() - 0.5) * 20
    const randomZ = bot.entity.position.z + (Math.random() - 0.5) * 20
    const goal = new goals.GoalNear(randomX, bot.entity.position.y, randomZ, 2)
    console.log("🔍 Exploring...")
    try { await bot.pathfinder.goto(goal) } catch { }
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
    if (!tableItem) return null

    const botPos = bot.entity.position.floored()
    const candidates = [
        botPos.offset(1, 0, 0), botPos.offset(-1, 0, 0),
        botPos.offset(0, 0, 1), botPos.offset(0, 0, -1),
    ]

    for (const pos of candidates) {
        const below = bot.blockAt(pos.offset(0, -1, 0))
        const target = bot.blockAt(pos)
        if (!below || below.type === 0) continue
        if (target && target.type !== 0) continue
        try {
            await bot.equip(tableItem, 'hand')
            await bot.placeBlock(below, new Vec3(0, 1, 0))
            await bot.waitForTicks(5)
            break
        } catch { }
    }

    return bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 5 })
}

async function craftItem(itemName, amount = 1) {
    const item = mcData.itemsByName[itemName]
    if (!item) return false

    let recipes = bot.recipesFor(item.id)
    let craftingTable = null

    if (recipes.length === 0) {
        craftingTable = await findOrPlaceCraftingTable()
        if (craftingTable) {
            const allRecipes = bot.recipesAll(item.id, null, craftingTable)
            recipes = allRecipes.filter(recipe =>
                recipe.delta.every(delta => {
                    if (delta.count >= 0) return true
                    const needed = mcData.items[delta.id]
                    if (!needed) return false
                    return countItem(needed.name) >= Math.abs(delta.count)
                })
            )
        }
    }

    if (recipes.length === 0) {
        console.log("❌ No craftable recipe for:", itemName)
        return false
    }

    try {
        await bot.craft(recipes[0], amount, craftingTable)
        console.log("🛠 Crafted:", itemName, "x" + amount)
        return true
    } catch (err) {
        console.log("❌ Craft error:", err.message)
        return false
    }
}

// ---------------- ACTIONS ----------------

async function collectWood() {
    const block = bot.findBlock({
        matching: b => b.name.includes('_log'),
        maxDistance: 32
    })
    if (!block) {
        await explore()
        return false
    }
    await moveNear(block.position)
    return await safeDig(block)
}

// ✅ craft planks จากไม้ที่มีใน inventory
async function craftPlanks() {
    const logTypes = [
        'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
        'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'
    ]
    const logInInventory = logTypes.find(log => countItem(log) > 0)
    if (!logInInventory) {
        console.log("❌ No logs in inventory")
        return false
    }
    const plankName = logInInventory.replace('_log', '_planks')
    console.log(`🪵 Crafting ${plankName} from ${logInInventory}`)
    return await craftItem(plankName, 4)
}

async function mineBlock(blockName, fallbackNames = []) {
    const names = [blockName, ...fallbackNames]
    let block = null

    for (const name of names) {
        const id = mcData.blocksByName[name]?.id
        if (!id) continue

        const candidates = bot.findBlocks({ matching: id, maxDistance: 32, count: 10 })

        for (const pos of candidates) {
            const b = bot.blockAt(pos)
            if (!b) continue

            const result = bot.world.raycast(
                bot.entity.position.offset(0, 1.6, 0),
                b.position.offset(0.5, 0.5, 0.5)
                    .minus(bot.entity.position.offset(0, 1.6, 0))
                    .normalize(),
                5
            )

            if (result && result.position.equals(b.position)) {
                block = b
                break
            }
        }

        if (block) break
    }

    if (!block) {
        console.log(`🔍 No visible ${blockName}, exploring...`)
        await explore()
        return false
    }

    console.log(`⛏ Moving to ${block.name} at ${block.position}`)
    await moveNear(block.position, 15000, false)
    return await safeDig(block)
}

// ---------------- FURNACE ----------------

async function findOrPlaceFurnace() {
    let furnaceBlock = bot.findBlock({
        matching: mcData.blocksByName.furnace.id,
        maxDistance: 32
    })
    if (furnaceBlock) {
        await moveNear(furnaceBlock.position)
        return furnaceBlock
    }

    const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace')
    if (!furnaceItem) return null

    const botPos = bot.entity.position.floored()
    const candidates = [
        botPos.offset(1, 0, 0), botPos.offset(-1, 0, 0),
        botPos.offset(0, 0, 1), botPos.offset(0, 0, -1),
    ]

    for (const pos of candidates) {
        const below = bot.blockAt(pos.offset(0, -1, 0))
        const target = bot.blockAt(pos)
        if (!below || below.type === 0) continue
        if (target && target.type !== 0) continue
        try {
            await bot.equip(furnaceItem, 'hand')
            await bot.placeBlock(below, new Vec3(0, 1, 0))
            await bot.waitForTicks(5)
            console.log("🔥 Placed furnace")
            break
        } catch (err) {
            console.log("❌ Place furnace error:", err.message)
        }
    }

    return bot.findBlock({ matching: mcData.blocksByName.furnace.id, maxDistance: 5 })
}

async function smeltItem(inputName, fuelName, outputName, amount = 1) {
    const furnaceBlock = await findOrPlaceFurnace()
    if (!furnaceBlock) {
        console.log("❌ No furnace available")
        return false
    }

    if (countItem(inputName) < amount) {
        console.log(`❌ Not enough ${inputName}`)
        return false
    }
    if (countItem(fuelName) < 1) {
        console.log(`❌ No fuel: ${fuelName}`)
        return false
    }

    try {
        const furnace = await bot.openFurnace(furnaceBlock)
        await bot.waitForTicks(10)

        const fuelItem = bot.inventory.items().find(i => i.name.includes(fuelName))
        const inputItem = bot.inventory.items().find(i => i.name.includes(inputName))

        if (!fuelItem) {
            console.log(`❌ Fuel item not found: ${fuelName}`)
            furnace.close()
            return false
        }
        if (!inputItem) {
            console.log(`❌ Input item not found: ${inputName}`)
            furnace.close()
            return false
        }

        console.log(`🔥 Fuel: ${fuelItem.name} x${fuelItem.count}`)
        console.log(`🔥 Input: ${inputItem.name} x${inputItem.count}`)

        await furnace.putFuel(fuelItem)
        await bot.waitForTicks(5)
        await furnace.putInput(inputItem)
        await bot.waitForTicks(5)

        console.log(`🔥 Smelting ${inputName} x${amount} with ${fuelName}...`)
        const waitTime = amount * 10000 + 3000
        await new Promise(resolve => setTimeout(resolve, waitTime))

        const outputBefore = countItem(outputName)
        await furnace.takeOutput()
        await bot.waitForTicks(5)
        furnace.close()

        const outputAfter = countItem(outputName)
        console.log(`✅ Smelted: got ${outputAfter - outputBefore} ${outputName}`)
        return outputAfter > outputBefore

    } catch (err) {
        console.log("❌ Smelt error:", err.message)
        return false
    }
}

// ✅ ใช้ countLogs() และรองรับ log ทุกชนิด
async function getFuel() {
    if (countItem('coal') >= 4) return true

    console.log("🔍 Looking for coal ore...")
    const coalBlock = bot.findBlock({
        matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore',
        maxDistance: 32
    })
    if (coalBlock) {
        await moveNear(coalBlock.position)
        await safeDig(coalBlock)
        if (countItem('coal') >= 4) return true
    }

    // fallback → charcoal จาก log ที่มี
    if (countItem('charcoal') < 4) {
        console.log("🌳 No coal, making charcoal...")
        if (countLogs() < 2) {
            await collectWood()
            return false
        }
        const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log',
            'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log']
        const availableLog = logTypes.find(l => countItem(l) > 0)
        if (!availableLog) return false
        await smeltItem(availableLog, availableLog, 'charcoal', 1)
    }

    return countItem('coal') >= 1 || countItem('charcoal') >= 1
}

// ---------------- AI LOGIC ----------------

async function aiLoop() {
    if (bot.entity) {
        const pos = bot.entity.position.clone()
        if (lastPos && pos.distanceTo(lastPos) < 0.2) stuckTicks++
        else stuckTicks = 0
        lastPos = pos
        if (stuckTicks > 8) await unstuck()
    }

    if (isBusy) return
    isBusy = true

    try {

        // ========== STONE AGE ==========

        // ✅ FIX: ใช้ countLogs() แทน countItem() ที่ขาด argument
        if (countLogs() < 3) {
            console.log("🧠 AI Loop Tick | Stage: collect_wood")
            await collectWood()
            return
        }

        // ✅ FIX: ใช้ countPlanks() + craftPlanks() แทน hardcode oak_planks
        if (countPlanks() < 4) {
            console.log("🧠 AI Loop Tick | Stage: craft_planks")
            await craftPlanks()
            return
        }

        if (!hasItem('crafting_table')) {
            console.log("🧠 AI Loop Tick | Stage: craft_table")
            await craftItem('crafting_table', 1)
            return
        }

        if (!hasItem('stick')) {
            console.log("🧠 AI Loop Tick | Stage: craft_sticks")
            await craftItem('stick', 4)
            return
        }

        if (!hasItem('wooden_pickaxe')) {
            console.log("🧠 AI Loop Tick | Stage: craft_wooden_pickaxe")
            await craftItem('wooden_pickaxe', 1)
            return
        }

        if (countItem('cobblestone') < 8) {
            console.log("🧠 AI Loop Tick | Stage: mine_stone")
            await mineBlock('stone')
            return
        }

        if (!hasItem('stone_pickaxe')) {
            console.log("🧠 AI Loop Tick | Stage: craft_stone_pickaxe")
            await craftItem('stone_pickaxe', 1)
            return
        }

        // ========== IRON AGE ==========

        if (!hasItem('furnace')) {
            console.log("🧠 AI Loop Tick | Stage: craft_furnace")
            await craftItem('furnace', 1)
            return
        }

        if (countItem('coal') < 4 && countItem('charcoal') < 4) {
            console.log("🧠 AI Loop Tick | Stage: get_fuel")
            await getFuel()
            return
        }

        if (countItem('raw_iron') < 3 && countItem('iron_ingot') < 3) {
            console.log("🧠 AI Loop Tick | Stage: mine_iron")
            await mineBlock('iron_ore', ['deepslate_iron_ore'])
            return
        }

        if (countItem('iron_ingot') < 3) {
            console.log("🧠 AI Loop Tick | Stage: smelt_iron")
            const fuel = countItem('coal') >= 1 ? 'coal' : 'charcoal'
            await smeltItem('raw_iron', fuel, 'iron_ingot', 3)
            return
        }

        if (!hasItem('iron_pickaxe')) {
            console.log("🧠 AI Loop Tick | Stage: craft_iron_pickaxe")
            if (countItem('stick') < 2) await craftItem('stick', 4)
            await craftItem('iron_pickaxe', 1)
            return
        }

        if (countItem('iron_ingot') < 24) {
            const needed = 24 - countItem('iron_ingot')
            if (countItem('raw_iron') < needed) {
                console.log("🧠 AI Loop Tick | Stage: mine_iron_for_armor")
                await mineBlock('iron_ore', ['deepslate_iron_ore'])
            } else {
                const fuel = countItem('coal') >= 1 ? 'coal' : 'charcoal'
                if (countItem('coal') < needed && countItem('charcoal') < needed) {
                    console.log("🧠 AI Loop Tick | Stage: get_fuel_for_armor")
                    await getFuel()
                } else {
                    console.log("🧠 AI Loop Tick | Stage: smelt_iron_for_armor")
                    await smeltItem('raw_iron', fuel, 'iron_ingot', Math.min(needed, countItem('raw_iron')))
                }
            }
            return
        }

        if (!hasItem('iron_helmet')) {
            console.log("🧠 AI Loop Tick | Stage: craft_iron_helmet")
            await craftItem('iron_helmet', 1)
            return
        }

        if (!hasItem('iron_chestplate')) {
            console.log("🧠 AI Loop Tick | Stage: craft_iron_chestplate")
            await craftItem('iron_chestplate', 1)
            return
        }

        if (!hasItem('iron_leggings')) {
            console.log("🧠 AI Loop Tick | Stage: craft_iron_leggings")
            await craftItem('iron_leggings', 1)
            return
        }

        if (!hasItem('iron_boots')) {
            console.log("🧠 AI Loop Tick | Stage: craft_iron_boots")
            await craftItem('iron_boots', 1)
            return
        }

        console.log("🧠 AI Loop Tick | Stage: complete")
        console.log("⚔️ Iron Age Complete!")

    } finally {
        isBusy = false
    }
}
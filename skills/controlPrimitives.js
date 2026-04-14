const { goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalFollow, GoalBlock } = goals

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Mine a specific block type nearby.
 * @param {object} bot - mineflayer bot
 * @param {string} name - block name or partial match (e.g. 'log', 'stone', 'iron_ore')
 * @param {number} count - how many to mine
 * @returns {Promise<boolean>} true if at least one was mined
 */
async function mineBlock(bot, name, count = 1) {
  const matchingIds = bot.registry.blocksArray
    .filter(b => b.name && b.name.includes(name))
    .map(b => b.id)

  let mined = 0
  for (let i = 0; i < count; i++) {
    const block = bot.findBlock({
      matching: matchingIds,
      maxDistance: 40
    })
    if (!block) {
      console.log(`⛏️ mineBlock: no ${name} found`)
      break
    }

    bot.pathfinder.setGoal(new GoalBlock(block.position.x, block.position.y, block.position.z))

    // Wait to reach block
    let reached = false
    for (let w = 0; w < 25; w++) {
      if (bot.entity.position.distanceTo(block.position) <= 3) {
        reached = true
        break
      }
      await sleep(200)
    }

    if (!reached) {
      console.log(`⛏️ mineBlock: can't reach ${name}`)
      break
    }

    try {
      const current = bot.blockAt(block.position)
      if (current && current.name.includes(name)) {
        await bot.dig(current)
        mined++
        console.log(`⛏️ mined ${current.name} (${mined}/${count})`)
      }
    } catch (e) {
      console.log(`⛏️ mineBlock error: ${e.message}`)
      break
    }

    await sleep(300)
  }
  return mined > 0
}

/**
 * Craft an item by name.
 * @param {object} bot - mineflayer bot
 * @param {string} name - item name (e.g. 'oak_planks', 'crafting_table', 'wooden_pickaxe')
 * @param {number} count - how many to craft
 * @returns {Promise<boolean>} true if crafted successfully
 */
async function craftItem(bot, name, count = 1) {
  const item = bot.registry.itemsByName[name]
  if (!item) {
    console.log(`🛠️ craftItem: unknown item ${name}`)
    return false
  }

  // Try without crafting table first
  let recipes = bot.recipesFor(item.id, null, count, null)

  // If no recipe, try with crafting table
  if (!recipes.length) {
    const blockId = bot.registry.blocksByName['crafting_table']?.id
    const tableBlock = bot.findBlock({
      matching: blockId,
      maxDistance: 32
    })

    if (tableBlock) {
      // Walk to crafting table
      bot.pathfinder.setGoal(new GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2))
      for (let w = 0; w < 20; w++) {
        if (bot.entity.position.distanceTo(tableBlock.position) <= 3) break
        await sleep(200)
      }
      recipes = bot.recipesFor(item.id, null, count, tableBlock)
    }
  }

  if (!recipes.length) {
    console.log(`🛠️ craftItem: no recipe for ${name}`)
    return false
  }

  try {
    await bot.craft(recipes[0], count)
    console.log(`🛠️ crafted ${name} x${count}`)
    return true
  } catch (e) {
    console.log(`🛠️ craftItem error: ${e.message}`)
    return false
  }
}

/**
 * Place a block from inventory.
 * @param {object} bot - mineflayer bot
 * @param {string} name - item name to place
 * @param {object} position - {x, y, z} or null for nearby
 * @returns {Promise<boolean>}
 */
async function placeItem(bot, name, position = null) {
  const item = bot.inventory.items().find(i => i.name === name)
  if (!item) {
    console.log(`📦 placeItem: don't have ${name}`)
    return false
  }

  try {
    await bot.equip(item, 'hand')
    const targetPos = position
      ? bot.blockAt(require('vec3')(position.x, position.y - 1, position.z))
      : bot.blockAt(bot.entity.position.offset(0, -1, 0))

    if (!targetPos) {
      console.log(`📦 placeItem: no reference block`)
      return false
    }

    await bot.placeBlock(targetPos, require('vec3')(0, 1, 0))
    console.log(`📦 placed ${name}`)
    return true
  } catch (e) {
    console.log(`📦 placeItem error: ${e.message}`)
    return false
  }
}

/**
 * Kill a mob by name.
 * @param {object} bot - mineflayer bot
 * @param {string} name - mob name (e.g. 'cow', 'zombie')
 * @param {number} timeout - max time in ms
 * @returns {Promise<boolean>}
 */
async function killMob(bot, name, timeout = 15000) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    let target = null
    for (const e of Object.values(bot.entities)) {
      if (e?.name === name && e.isValid) {
        const d = bot.entity.position.distanceTo(e.position)
        if (d < 32 && (!target || d < bot.entity.position.distanceTo(target.position))) {
          target = e
        }
      }
    }

    if (!target) {
      console.log(`⚔️ killMob: no ${name} found`)
      return false
    }

    bot.pathfinder.setGoal(new GoalFollow(target, 2), true)

    for (let i = 0; i < 10; i++) {
      if (!target.isValid) break
      const d = bot.entity.position.distanceTo(target.position)
      if (d <= 3) break
      await sleep(200)
    }

    if (!target.isValid) {
      console.log(`⚔️ killed ${name}`)
      return true
    }

    try {
      await bot.lookAt(target.position.offset(0, 1, 0))
      bot.attack(target)
    } catch (e) { /* ignore attack errors */ }

    await sleep(400)
  }

  console.log(`⚔️ killMob timeout for ${name}`)
  return false
}

/**
 * Smelt an item using a furnace.
 * @param {object} bot - mineflayer bot
 * @param {string} itemName - item to smelt (e.g. 'raw_iron')
 * @param {string} fuelName - fuel to use (e.g. 'coal', 'oak_planks')
 * @param {number} count - how many to smelt
 * @returns {Promise<boolean>}
 */
async function smeltItem(bot, itemName, fuelName = 'coal', count = 1) {
  const furnaceId = bot.registry.blocksByName['furnace']?.id
  const furnaceBlock = bot.findBlock({
    matching: furnaceId,
    maxDistance: 32
  })

  if (!furnaceBlock) {
    console.log(`🔥 smeltItem: no furnace found`)
    return false
  }

  bot.pathfinder.setGoal(new GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2))

  for (let w = 0; w < 20; w++) {
    if (bot.entity.position.distanceTo(furnaceBlock.position) <= 3) break
    await sleep(200)
  }

  try {
    const furnace = await bot.openFurnace(furnaceBlock)
    const inputItem = bot.inventory.items().find(i => i.name === itemName)
    const fuel = bot.inventory.items().find(i => i.name === fuelName)

    if (!inputItem) {
      console.log(`🔥 smeltItem: don't have ${itemName}`)
      furnace.close()
      return false
    }
    if (!fuel) {
      console.log(`🔥 smeltItem: don't have fuel ${fuelName}`)
      furnace.close()
      return false
    }

    await furnace.putInput(inputItem.type, null, Math.min(count, inputItem.count))
    await furnace.putFuel(fuel.type, null, Math.min(count, fuel.count))

    // Wait for smelting
    console.log(`🔥 smelting ${itemName}...`)
    await sleep(count * 10000 + 2000)

    furnace.close()
    console.log(`🔥 smelted ${itemName} x${count}`)
    return true
  } catch (e) {
    console.log(`🔥 smeltItem error: ${e.message}`)
    return false
  }
}

/**
 * Explore in a direction until a callback returns true.
 * @param {object} bot - mineflayer bot
 * @param {string} direction - 'north', 'south', 'east', 'west', or 'random'
 * @param {number} maxTime - max exploration time in ms
 * @param {function} callback - function(bot) called every 2s, return true to stop
 * @returns {Promise<boolean>} true if callback triggered
 */
async function exploreUntil(bot, direction = 'random', maxTime = 30000, callback = null) {
  const start = Date.now()
  const dirs = {
    north: [0, -1],
    south: [0, 1],
    east: [1, 0],
    west: [-1, 0]
  }

  while (Date.now() - start < maxTime) {
    if (callback) {
      try {
        if (callback(bot)) return true
      } catch (e) { /* ignore callback errors */ }
    }

    const p = bot.entity.position
    let dx, dz
    if (direction === 'random' || !dirs[direction]) {
      dx = Math.random() * 30 - 15
      dz = Math.random() * 30 - 15
    } else {
      const [ddx, ddz] = dirs[direction]
      dx = ddx * (15 + Math.random() * 15)
      dz = ddz * (15 + Math.random() * 15)
    }

    const tx = Math.floor(p.x + dx)
    const tz = Math.floor(p.z + dz)
    const ty = Math.floor(p.y)

    bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 3))
    await sleep(3000)
  }

  return false
}

module.exports = {
  mineBlock,
  craftItem,
  placeItem,
  killMob,
  smeltItem,
  exploreUntil
}

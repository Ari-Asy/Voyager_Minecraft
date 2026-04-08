const { journal } = require('../core/memory')

async function craftOne(bot, name, count = 1, table = null) {
  const item = bot.registry.itemsByName[name]
  if (!item) return false
  const recipes = bot.recipesFor(item.id, null, count, table)
  if (!recipes.length) return false
  try {
    await bot.craft(recipes[0], count, table)
    console.log(`🛠 crafted ${name}`)
    return true
  } catch (e) {
    console.log(`craft ${name} error:`, e.message)
    return false
  }
}

async function craftBasic(bot, memory) {
  const items = bot.inventory.items()
  const hasPlanks = items.some(i => i.name.includes('planks'))
  const hasTable = items.some(i => i.name === 'crafting_table')

  if (!hasPlanks) {
    const plankCandidates = [
      'oak_planks','spruce_planks','birch_planks','jungle_planks',
      'acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks'
    ]
    for (const p of plankCandidates) {
      if (await craftOne(bot, p, 4, null)) {
        journal(memory, `crafted ${p}`)
        return
      }
    }
  }

  if (!hasTable) {
    if (await craftOne(bot, 'crafting_table', 1, null)) {
      journal(memory, 'crafted crafting_table')
      return
    }
  }
}

module.exports = { craftBasic }
const { journal } = require('../core/memory')

async function eatFood(bot, memory) {
  const edible = bot.inventory.items().find(i => !!bot.registry.foodsByName[i.name])
  if (!edible) {
    console.log('🍽️ no edible food')
    return
  }

  try {
    console.log(`🍽️ eat ${edible.name}`)
    await bot.equip(edible, 'hand')
    await bot.consume()
    journal(memory, `ate ${edible.name}`)
  } catch (e) {
    console.log('eat error:', e.message)
  }
}

module.exports = { eatFood }
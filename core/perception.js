function itemCount(bot, keyword) {
  return bot.inventory.items()
    .filter(i => i.name.includes(keyword))
    .reduce((sum, i) => sum + i.count, 0)
}

function hasItem(bot, name) {
  return bot.inventory.items().some(i => i.name === name)
}

function findNearestTree(bot) {
  const logIds = bot.registry.blocksArray
    .filter(b => b.name && b.name.includes('log'))
    .map(b => b.id)
  
  const block = bot.findBlock({
    matching: logIds,
    maxDistance: 24
  })
  if (!block) return null
  return {
    name: block.name,
    x: block.position.x,
    y: block.position.y,
    z: block.position.z
  }
}

function findNearestFoodMob(bot, maxDistance = 24) {
  const names = new Set(['cow', 'pig', 'chicken', 'sheep'])
  let best = null
  for (const e of Object.values(bot.entities)) {
    if (!e?.name || !names.has(e.name)) continue
    const d = bot.entity.position.distanceTo(e.position)
    if (d > maxDistance) continue
    if (!best || d < best.d) best = { entity: e, d }
  }
  if (!best) return null
  return {
    name: best.entity.name,
    x: Math.floor(best.entity.position.x),
    y: Math.floor(best.entity.position.y),
    z: Math.floor(best.entity.position.z),
    distance: Math.round(best.d)
  }
}

function findNearestHostile(bot, maxDistance = 12) {
  const names = new Set(['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'drowned', 'husk'])
  let best = null
  for (const e of Object.values(bot.entities)) {
    if (!e?.name || !names.has(e.name)) continue
    const d = bot.entity.position.distanceTo(e.position)
    if (d > maxDistance) continue
    if (!best || d < best.d) best = { entity: e, d }
  }
  if (!best) return null
  return {
    name: best.entity.name,
    x: Math.floor(best.entity.position.x),
    y: Math.floor(best.entity.position.y),
    z: Math.floor(best.entity.position.z),
    distance: Math.round(best.d)
  }
}

function edibleFood(bot) {
  return bot.inventory.items().find(i => !!bot.registry.foodsByName[i.name]) || null
}

function perceive(bot, memory, opts = { skipEnv: false }) {
  const timeOfDay = bot.time?.timeOfDay ?? 0
  return {
    health: bot.health,
    food: bot.food,
    isNight: timeOfDay >= 13000,
    timeOfDay,
    pos: {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z)
    },
    tree: opts.skipEnv ? null : findNearestTree(bot),
    foodMob: findNearestFoodMob(bot),
    hostile: findNearestHostile(bot),
    edibleFood: edibleFood(bot)?.name || null,
    logCount: itemCount(bot, 'log'),
    plankCount: itemCount(bot, 'planks'),
    stickCount: itemCount(bot, 'stick'),
    hasCraftingTable: hasItem(bot, 'crafting_table'),
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
  }
}

module.exports = { perceive }
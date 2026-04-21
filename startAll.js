/**
 * startAll.js — Run both Bot1 (Ollama) and Bot2 (Groq) in a SINGLE Node.js process.
 * 
 * Why? Two separate Node.js processes each load their own V8 engine, mineflayer
 * registry, pathfinder navmesh, and chunk data — doubling base RAM from ~800MB to ~1.6GB
 * BEFORE any LLM calls. Running in one process shares all of that.
 * 
 * Usage: npm run startAll
 */

console.log('🚀 Starting both bots in single process...\n')

// Stagger bot2 by 8 seconds to avoid simultaneous chunk loading spikes
require('./bot')
setTimeout(() => require('./bot2'), 8000)

// Periodic manual GC if --expose-gc was passed
if (global.gc) {
  setInterval(() => {
    const before = process.memoryUsage().heapUsed
    global.gc()
    const after = process.memoryUsage().heapUsed
    const freed = Math.round((before - after) / 1024 / 1024)
    if (freed > 5) console.log(`🧹 GC freed ${freed}MB`)
  }, 60000) // every 60 seconds
}

// Log memory usage every 2 minutes
setInterval(() => {
  const mem = process.memoryUsage()
  console.log(`📊 Memory: heap=${Math.round(mem.heapUsed/1024/1024)}MB / ${Math.round(mem.heapTotal/1024/1024)}MB | rss=${Math.round(mem.rss/1024/1024)}MB`)
}, 120000)

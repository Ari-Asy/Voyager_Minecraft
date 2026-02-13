const mineflayer = require('mineflayer')
const axios = require('axios')

const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'AI_1'
})

function logAction(action_type, target = null, result = "success") {
    axios.post('http://localhost:5000/log/action', {
        agent_id: "AI_1",
        action_type: action_type,
        target: target,
        result: result,
        duration: null,
        error_message: null
    }).catch(err => console.log("Log error:", err.message))
}

function logState() {
    axios.post('http://localhost:5000/log/state', {
        agent_id: "AI_1",
        position: [
            bot.entity.position.x,
            bot.entity.position.y,
            bot.entity.position.z
        ],
        health: bot.health,
        hunger: bot.food,
        inventory: bot.inventory.items().map(i => i.name),
        current_task: "random_walk"
    }).catch(err => console.log("State log error:", err.message))
}

bot.once('spawn', () => {
    console.log('Bot spawned and starting AI loop')

    setInterval(aiLoop, 3000)
})

async function aiLoop() {
    try {
        const block = bot.findBlock({
            matching: block => block.name.includes("log"),
            maxDistance: 6
        })

        if (block) {
            console.log("Wood detected. Mining...")
            logAction("detect_wood", block.name)

            await bot.dig(block)
            logAction("mine", block.name)

        } else {
            console.log("No wood found. Walking randomly.")
            randomWalk()
            logAction("random_walk")
        }

        logState()

    } catch (err) {
        logAction("error", null, "fail")
        console.log("AI Loop error:", err.message)
    }
}

function randomWalk() {
    bot.setControlState('forward', true)
    const yaw = Math.random() * Math.PI * 2
    bot.look(yaw, 0, true)

    setTimeout(() => {
        bot.setControlState('forward', false)
    }, 2000)
}

bot.on('death', () => {
    logAction("death", null, "fail")
})
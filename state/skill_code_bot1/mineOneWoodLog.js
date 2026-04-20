async function mineOneWoodLog(bot) {
  try {
    await mineBlock(bot, 'oak_log', 1);
  } catch (err) {
    console.error("Error mining wood log:", err);
  }
}
from logger.logger import Logger

logger = Logger()

# Test Action
logger.log_action(
    agent_id="AI_1",
    action_type="mine",
    target="oak_log",
    result="success",
    duration=2.3
)

# Test State
logger.log_state(
    agent_id="AI_1",
    position=(10, 64, -5),
    health=20,
    hunger=18,
    inventory=["oak_log", "stick"],
    current_task="collect_wood"
)

# Test Interaction
logger.log_interaction(
    source_agent="AI_1",
    target_agent="AI_2",
    interaction_type="give",
    resource="oak_log",
    outcome="success"
)

# Test Skill
logger.log_skill(
    agent_id="AI_1",
    skill_id="S001",
    skill_name="collect_wood",
    usage_count=5,
    success_rate=0.8
)

print("Logging test completed.")
import json
import time
import os
from threading import Lock

class Logger:
    def __init__(self, log_dir="logs"):
        self.log_dir = log_dir
        self.lock = Lock()
        
        os.makedirs(self.log_dir, exist_ok=True)

        self.action_log_file = os.path.join(log_dir, "action_log.json")
        self.state_log_file = os.path.join(log_dir, "state_log.json")
        self.interaction_log_file = os.path.join(log_dir, "interaction_log.json")
        self.skill_log_file = os.path.join(log_dir, "skill_log.json")

    #Internal Write Method
    def _write_log(self, filepath, data):
        with self.lock:
            with open(filepath, "a", encoding="utf-8") as f:
                f.write(json.dumps(data) + "\n")

    # 1.Action Log
    def log_action(self, agent_id, action_type, target=None, result="success", duration=None, error_message=None):
        log_entry = {
            "timestamp": time.time(),
            "agent_id": agent_id,
            "event_type": "action",
            "action_type": action_type,
            "target": target,
            "result": result,
            "duration": duration,
            "error_message": error_message
        }
        self._write_log(self.action_log_file, log_entry)

    # 2.State Log
    def log_state(self, agent_id, position, health=None, hunger=None, inventory=None, current_task=None):
        log_entry = {
            "timestamp": time.time(),
            "agent_id": agent_id,
            "event_type": "state",
            "position": {
                "x": position[0],
                "y": position[1],
                "z": position[2]
            },
            "health": health,
            "hunger": hunger,
            "inventory": inventory,
            "current_task": current_task
        }
        self._write_log(self.state_log_file, log_entry)

    # 3.Interaction Log ( IF 2 AI )
    def log_interaction(self, source_agent, target_agent, interaction_type, resource=None, outcome="success"):
        log_entry = {
            "timestamp": time.time(),
            "event_type": "interaction",
            "source_agent": source_agent,
            "target_agent": target_agent,
            "interaction_type": interaction_type,
            "resource": resource,
            "outcome": outcome
        }
        self._write_log(self.interaction_log_file, log_entry)

    # 4.Skill Log (Voyager Core)
    def log_skill(self, agent_id, skill_id, skill_name, usage_count=0, success_rate=0.0):
        log_entry = {
            "timestamp": time.time(),
            "event_type": "skill",
            "agent_id": agent_id,
            "skill_id": skill_id,
            "skill_name": skill_name,
            "usage_count": usage_count,
            "success_rate": success_rate
        }
        self._write_log(self.skill_log_file, log_entry)
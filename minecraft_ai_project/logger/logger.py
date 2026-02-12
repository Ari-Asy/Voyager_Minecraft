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

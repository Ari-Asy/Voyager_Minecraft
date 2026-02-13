from flask import Flask, request, jsonify
from logger.logger import Logger

app = Flask(__name__)
logger = Logger()

@app.route("/log/action", methods=["POST"])
def log_action():
    data = request.json
    logger.log_action(
        agent_id=data.get("agent_id"),
        action_type=data.get("action_type"),
        target=data.get("target"),
        result=data.get("result"),
        duration=data.get("duration"),
        error_message=data.get("error_message")
    )
    return jsonify({"status": "logged"})

@app.route("/log/state", methods=["POST"])
def log_state():
    data = request.json
    logger.log_state(
        agent_id=data.get("agent_id"),
        position=data.get("position"),
        health=data.get("health"),
        hunger=data.get("hunger"),
        inventory=data.get("inventory"),
        current_task=data.get("current_task")
    )
    return jsonify({"status": "logged"})

if __name__ == "__main__":
    app.run(port=5000)
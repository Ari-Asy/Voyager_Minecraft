from flask import Flask, request, jsonify
import json
import os

app = Flask(__name__)

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

def append_log(filename, data):
    path = os.path.join(LOG_DIR, filename)
    with open(path, "a") as f:
        f.write(json.dumps(data) + "\n")

@app.route("/action", methods=["POST"])
def action():
    data = request.json
    append_log("actions.log", data)
    return jsonify({"status": "ok"})

@app.route("/state", methods=["POST"])
def state():
    data = request.json
    append_log("states.log", data)
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(port=5000)
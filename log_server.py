from flask import Flask, request, jsonify
from logger.logger import Logger
import random
import json
import os

app = Flask(__name__)
logger = Logger()

# --- 🧠 ระบบจัดการไฟล์ความจำ (Long-term Memory) ---
MEMORY_FILE = "logs/ai_memory.json"

def load_memory():
    # ถ้ามีไฟล์ความจำอยู่แล้ว ให้โหลดขึ้นมา
    if os.path.exists(MEMORY_FILE):
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    # ถ้ายังไม่มี (รันครั้งแรก) ให้คืนค่าว่างเปล่า (Dictionary ว่าง)
    return {}

def save_memory(memory_data):
    # บันทึกความจำลงไฟล์ .json แบบอ่านง่าย (indent=4)
    with open(MEMORY_FILE, "w", encoding="utf-8") as f:
        json.dump(memory_data, f, indent=4)

# โหลดความจำขึ้นมาทันทีที่เปิด Server
ai_memory = load_memory()

# --- Endpoint 1: รับข้อมูลการกระทำและอัปเดตความจำ (Action Log & Learning) ---
@app.route("/log/action", methods=["POST"])
def log_action():
    data = request.json
    
    agent_id = data.get("agent_id")
    action_type = data.get("action_type")
    result = data.get("result")
    
    # 🧠 การเรียนรู้: เช็คว่ามี Agent นี้ในหัวหรือยัง ถ้ายังให้สร้างโปรไฟล์ใหม่
    if agent_id not in ai_memory:
        ai_memory[agent_id] = {}
        
    # ถ้ายังไม่เคยทำแอคชั่นนี้ ให้บันทึกสถิติเริ่มต้นที่ 0
    if action_type not in ai_memory[agent_id]:
        ai_memory[agent_id][action_type] = {"success": 0, "fail": 0}
        
    # บวกคะแนนความสำเร็จ/ล้มเหลว
    if result in ["success", "mining_success", "wandered", "chatted"]:
        ai_memory[agent_id][action_type]["success"] += 1
    else:
        ai_memory[agent_id][action_type]["fail"] += 1
        
    print(f"📈 [Learning Update] {agent_id} Memory Saved! (Action: {action_type}, Result: {result})")
    
    # สั่งบันทึกลงไฟล์ทันทีที่ความจำเปลี่ยน (แม้ปิดคอม ข้อมูลก็ไม่หาย)
    save_memory(ai_memory)

    # บันทึก Log ลงไฟล์หลักตามปกติที่คุณเคยทำไว้
    logger.log_action(
        agent_id=agent_id,
        action_type=action_type,
        target=data.get("target"),
        result=result,
        duration=data.get("duration"),
        error_message=data.get("error_message")
    )
    return jsonify({"status": "logged"})

# --- Endpoint 2: รับข้อมูลสถานะปัจจุบัน (State Log) ---
@app.route("/log/state", methods=["POST"])
def log_state():
    data = request.json
    logger.log_state(
        agent_id=data.get("agent_id"),
        position=data.get("position"),
        health=data.get("health"),
        hunger=data.get("hunger"),
        inventory=data.get("inventory"),
        current_task=data.get("current_task", "waiting_instruction")
    )
    return jsonify({"status": "logged"})

# --- Endpoint 3: สมองของ AI (Decision Making) ---
@app.route("/decide", methods=["POST"])
def decide_action():
    try:
        data = request.json
        agent_id = data.get("agent_id")
        nearby = data.get("nearby", {}) # สิ่งที่บอทมองเห็น
        
        # 🧠 ดึงความจำของบอทตัวนั้นๆ มาดู (อนาคตเอาไว้ให้ LLM วิเคราะห์)
        memory = ai_memory.get(agent_id, {})
        print(f"🧠 Agent {agent_id} is asking for instruction... Current Memory size: {len(memory)} skills")

        blocks_seen = nearby.get("blocks", [])
        
        # --- Logic การตัดสินใจเบื้องต้น ---
        command = "wander" 
        target = None
        
        # ถ้ามีคำว่า log (ไม้) อยู่ในบล็อกที่มองเห็น ให้สั่งขุด
        if any("log" in b for b in blocks_seen):
            command = "mine"
            # หาชื่อบล็อกไม้แบบเป๊ะๆ เพื่อส่งให้บอท
            target = next((b for b in blocks_seen if "log" in b), "oak_log")

        print(f"💡 Brain decided: {command} {target if target else ''}")
        return jsonify({"command": command, "target": target})

    except Exception as e:
        print(f"❌ Error in decision: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    # บรรทัดนี้จะสร้างโฟลเดอร์ logs อัตโนมัติถ้ายังไม่มี ป้องกัน error หาที่เก็บไฟล์ไม่เจอ
    os.makedirs("logs", exist_ok=True)
    print("🚀 Brain Server is running on port 5000...")
    app.run(port=5000, debug=True)
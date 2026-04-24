import os
import sys
from inference import llm_decide

obs = {
    "network_summary": {"total_nodes": 20, "layers": {}},
    "active_alarms": [],
    "total_alarm_count": 0,
    "steps_remaining": 15,
    "false_positives_so_far": 0,
    "checked_nodes": []
}
history = []

print("Running llm_decide...")
try:
    action = llm_decide(obs, history)
    print("Action returned:", action)
except Exception as e:
    print("Top level error:", e)

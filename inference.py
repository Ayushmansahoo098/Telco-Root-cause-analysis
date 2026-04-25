"""
inference.py — Telco-RCA baseline inference script.

Runs a heuristic + LLM agent against all configured tasks
and emits structured [START] / [STEP] / [END] logs as required by the spec.

The agent uses a sophisticated top-down diagnosis strategy:
  1. Analyse the alarm landscape — group by layer, region, parent
  2. Identify the "cone of failure" — which subtree is impacted
  3. Walk upward from leaf alarms to find the highest-layer failing node
  4. CHECK_VOLTAGE suspected root nodes (voltage drop = smoking gun)
  5. Use TRACE_PATH to confirm parent–child relationships
  6. RESTART (confident) or DIAGNOSE (safe) the root cause

Usage:
    python inference.py

Environment variables:
    API_BASE_URL       LLM endpoint  (default: https://api.openai.com/v1)
    MODEL_NAME         Model string  (default: claude-sonnet-4-20250514)
    HF_TOKEN           API key alias
    OPENAI_API_KEY     API key alias
    SERVER_URL         Environment server URL (default: http://localhost:7860)
    INTERNAL_API_TOKEN Optional token for /state/internal
    TASK_NAME          Optional single task override
    TASKS              Optional comma-separated task list
    TASK_SEED          Optional per-run seed override
    EPISODE_SEED       Optional per-run seed override
"""

import json
import os
import sys
import time
import re
import random
from openai import OpenAI

# ── Config ────────────────────────────────────────────────────────────
API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")
HF_TOKEN = os.getenv("HF_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")

SERVER_URL = os.getenv("SERVER_URL", "http://localhost:7860")

client = OpenAI(
    api_key=HF_TOKEN or OPENAI_API_KEY or "no-key",
    base_url=API_BASE_URL,
)

# ── HTTP helpers ──────────────────────────────────────────────────────
import urllib.request


def _post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    url = f"{SERVER_URL.rstrip('/')}/{path.lstrip('/')}"
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _get(path: str, headers: dict[str, str] | None = None) -> dict:
    url = f"{SERVER_URL.rstrip('/')}/{path.lstrip('/')}"
    req = urllib.request.Request(
        url,
        headers=headers or {},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


# ── LLM Agent ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert 5G network engineer specialising in Root Cause Analysis (RCA).
You are given a set of active alarms from a 5G network. Your job is to identify the single root
cause node — the one failed piece of equipment whose failure is responsible for all downstream alarms.

## Network Topology (layers from root to leaf):
  power_unit → core_switch → radio_controller → cell_tower

## Key Insight:
When a parent node fails, ALL its children generate symptom alarms. The real fault is the
HIGHEST-layer node that is actually broken. Downstream alarms are just symptoms.

## Node ID Naming Convention:
  PWR_XXX           — Power Units (layer 0, roots)
  SW_XX_XX          — Core Switches (layer 1, children of PWR)
  RC_XX_XX_XX       — Radio Controllers (layer 2, children of SW)
  TOWER_XX_XX_XX_XX — Cell Towers (layer 3, leaves)

## Actions Available:
  CHECK_LOGS <node_id>    — Read error logs (costs 1 step, gives status + textual clues)
  CHECK_VOLTAGE <node_id> — Measure voltage (low voltage = hardware fault, CRITICAL if < 30V)
  TRACE_PATH <node_id>    — Show full path from node up to tree root + direct children with status
  RESTART <node_id>       — Fix the network IF it's the root cause (+reward), else FALSE POSITIVE (-0.3)
  DIAGNOSE <node_id>      — Declare root cause without restarting (safer, lower max reward)

## CRITICAL RULES:
1. NEVER repeat the same action on the same node. If you already checked voltage on a node, do NOT check it again.
2. If CHECK_VOLTAGE returns CRITICAL (<30V), that node is very likely the root cause. Immediately DIAGNOSE or RESTART it.
3. If a node's voltage is NOMINAL (48V), it is healthy — move on to other suspects.
4. Use TRACE_PATH at least once early on to understand the dependency tree.
5. After 3-4 checks, you MUST commit to a DIAGNOSE or RESTART action. Do not keep checking forever.
6. Each step costs time. Be decisive.

## Strategy:
1. Look at the alarms. Group by node prefix to find the affected subtree.
2. Use TRACE_PATH on the most alarming leaf node to find its parent chain.
3. CHECK_VOLTAGE on the highest-layer suspect (prefer PWR_ then SW_ nodes).
4. If voltage is CRITICAL → immediately DIAGNOSE that node.
5. If voltage is NOMINAL → that node is fine, check the next candidate.
6. NEVER check the same node twice.

## Response Format:
Respond with EXACTLY one JSON object, nothing else:
{"action_type": "CHECK_LOGS"|"CHECK_VOLTAGE"|"RESTART"|"DIAGNOSE"|"TRACE_PATH", "target_node_id": "<node_id>"}
"""


def llm_decide(obs: dict, history: list[dict]) -> dict:
    """Ask the LLM what to do next. Returns an action dict."""
    all_alarms = list(obs.get("active_alarms", []))
    random.shuffle(all_alarms)
    
    alarm_summary = []
    for a in all_alarms[:30]:  # show more context
        alarm_summary.append(
            f"  [{a['severity']}] {a['node_id']} ({a['layer']}): {a['message']}"
        )

    # Network summary context
    net_summary = obs.get("network_summary", {})
    layers_info = net_summary.get("layers", {})
    regions_info = net_summary.get("regions", {})

    layer_str = "\n".join(
        f"  {layer}: {info['alarming']}/{info['total']} alarming"
        for layer, info in layers_info.items()
    )
    region_str = "\n".join(
        f"  {region}: {info['alarming_nodes']}/{info['total_nodes']} alarming"
        for region, info in regions_info.items()
    )

    # Detect repeated actions to warn the LLM
    action_counts = {}
    for h in history:
        key = f"{h.get('action_type', '')}({h.get('target_node_id', '')})"
        action_counts[key] = action_counts.get(key, 0) + 1
    repeated = [k for k, v in action_counts.items() if v >= 2]
    repeated_warning = ""
    if repeated:
        repeated_warning = f"\n\n⚠️ WARNING: You have REPEATED these actions: {', '.join(repeated)}. DO NOT repeat them. Choose a DIFFERENT action or DIAGNOSE a CRITICAL node NOW."

    # Find nodes with CRITICAL voltage from history
    critical_nodes = []
    for h in history:
        info = h.get('info', {})
        if info.get('status') == 'CRITICAL' or 'CRITICAL' in str(h.get('info', '')):
            tid = h.get('target_node_id', '')
            if tid:
                critical_nodes.append(tid)
    critical_hint = ""
    if critical_nodes:
        critical_hint = f"\n\n🔴 CRITICAL NODES FOUND: {', '.join(set(critical_nodes))}. You should DIAGNOSE one of these immediately!"

    checked_summary = f"Summary of all nodes checked so far: {', '.join(obs['checked_nodes']) if obs['checked_nodes'] else 'None'}"

    user_msg = f"""Active alarms ({obs['total_alarm_count']} total, showing first {len(alarm_summary)}):
{chr(10).join(alarm_summary) if alarm_summary else '  (none)'}

Network Layer Summary:
{layer_str or '  (unavailable)'}

Region Summary:
{region_str or '  (unavailable)'}

Steps remaining: {obs['steps_remaining']}
False positives so far: {obs['false_positives_so_far']}
Nodes already checked: {obs['checked_nodes']}

{checked_summary}
{repeated_warning}{critical_hint}

What is your next action? Respond with ONLY a JSON object."""

    print(f"--- LLM INPUT ---\n{user_msg}\n--- END LLM INPUT ---", file=sys.stderr)
    action = None
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=MODEL_NAME,
                max_tokens=150,
                temperature=0.4,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
            )
            raw = resp.choices[0].message.content.strip()
            
            # Robust JSON extraction: capture from first { to last }
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                raw = match.group(0)
            else:
                # Strip markdown fences if present as fallback
                raw = re.sub(r"```(?:json)?|```", "", raw).strip()
            
            action = json.loads(raw)
            break
        except Exception as e:
            print(f"⚠️ [LLM Exception Attempt {attempt+1}/3] {e}", file=sys.stderr)
            if attempt < 2:
                time.sleep(2)
                continue
            else:
                print("🛑 [LLM FAILED] Falling back to 4-step heuristic strategy.", file=sys.stderr)
                action = _heuristic_fallback(obs, history)

    return action


def _heuristic_fallback(obs: dict, history: list[dict]) -> dict:
    """
    Deterministic heuristic when LLM fails.
    Strategy: TRACE → CHECK_VOLTAGE parents → DIAGNOSE critical → fallback.
    NEVER repeats an (action, node) pair.
    """
    alarms = obs.get("active_alarms", [])
    checked = set(obs.get("checked_nodes", []))

    # Build a set of all (action_type, target_node_id) we've already done
    # Normalize action_type to uppercase since frontend sends lowercase (trace_path vs TRACE_PATH)
    done_pairs = set()
    for h in history:
        done_pairs.add((h.get("action_type", "").upper(), h.get("target_node_id", "")))

    def _is_new(action_type, node_id):
        return (action_type, node_id) not in done_pairs

    # ── Phase 1: TRACE_PATH on the most severe alarming node (just once) ──
    severity_order = {"CRITICAL": 4, "MAJOR": 3, "WARNING": 2, "MINOR": 1}
    sorted_alarms = sorted(alarms, key=lambda a: severity_order.get(a.get("severity", ""), 0), reverse=True)

    for a in sorted_alarms:
        nid = a["node_id"]
        if _is_new("TRACE_PATH", nid):
            return {"action_type": "TRACE_PATH", "target_node_id": nid}

    # ── Phase 2: CHECK_VOLTAGE on parent nodes (PWR first, then SW) ──
    parent_candidates = set()
    for a in alarms:
        nid = a["node_id"]
        if nid.startswith("TOWER_"):
            parts = nid[6:]
            rc_parts = "_".join(parts.split("_")[:-1])
            parent_candidates.add(f"RC_{rc_parts}")
        elif nid.startswith("RC_"):
            parts = nid[3:]
            sw_parts = "_".join(parts.split("_")[:-1])
            parent_candidates.add(f"SW_{sw_parts}")
        elif nid.startswith("SW_"):
            parts = nid[3:]
            pwr_idx = int(parts.split("_")[0])
            parent_candidates.add(f"PWR_{pwr_idx:03d}")
        elif nid.startswith("PWR_"):
            parent_candidates.add(nid)

    # Also add direct PWR/SW from alarms
    for a in alarms:
        if a["node_id"].startswith("PWR_") or a["node_id"].startswith("SW_"):
            parent_candidates.add(a["node_id"])

    # Sort: PWR first, then SW, then RC
    layer_priority = {"PWR": 0, "SW": 1, "RC": 2}
    sorted_parents = sorted(parent_candidates, key=lambda p: (layer_priority.get(p.split("_")[0], 9), p))

    for p in sorted_parents:
        if _is_new("CHECK_VOLTAGE", p):
            return {"action_type": "CHECK_VOLTAGE", "target_node_id": p}

    # ── Phase 3: DIAGNOSE any node we found with CRITICAL/FAILED status ──
    # Parse history results for CRITICAL indicators
    for h in reversed(history):
        info = h.get("info", {})
        result_str = str(info.get("status", "")) + " " + str(h.get("info", ""))
        target = h.get("target_node_id", "")
        if target and ("CRITICAL" in result_str or "FAILED" in result_str):
            if _is_new("DIAGNOSE", target):
                return {"action_type": "DIAGNOSE", "target_node_id": target}

    # ── Phase 4: CHECK_LOGS on unchecked alarm nodes ──
    for a in sorted_alarms:
        nid = a["node_id"]
        if _is_new("CHECK_LOGS", nid):
            return {"action_type": "CHECK_LOGS", "target_node_id": nid}

    # ── Phase 5: Last resort — diagnose highest severity alarm ──
    for a in sorted_alarms:
        nid = a["node_id"]
        if _is_new("DIAGNOSE", nid):
            return {"action_type": "DIAGNOSE", "target_node_id": nid}

    # Absolute fallback
    if alarms:
        return {"action_type": "DIAGNOSE", "target_node_id": alarms[0]["node_id"]}

    return {"action_type": "DIAGNOSE", "target_node_id": "UNKNOWN"}


# Fixed seeds for reproducible baseline runs
TASK_SEEDS = {"easy": 42, "medium": 1042, "hard": 2042, "extreme": 3042}
DEFAULT_TASK_MAX_STEPS = {"easy": 15, "medium": 30, "hard": 50, "extreme": 75}
_TASK_CATALOG_CACHE: dict[str, dict] | None = None


def _task_seed(task: str) -> int:
    override = os.environ.get("EPISODE_SEED") or os.environ.get("TASK_SEED")
    if override:
        try:
            return int(override)
        except ValueError:
            pass
    return TASK_SEEDS.get(task, 42)


def _task_max_steps(task: str) -> int:
    if task in DEFAULT_TASK_MAX_STEPS:
        return DEFAULT_TASK_MAX_STEPS[task]

    global _TASK_CATALOG_CACHE
    if _TASK_CATALOG_CACHE is None:
        try:
            catalog = _get("/tasks").get("tasks", [])
            _TASK_CATALOG_CACHE = {
                entry["name"]: entry
                for entry in catalog
                if isinstance(entry, dict) and entry.get("name")
            }
        except Exception:
            _TASK_CATALOG_CACHE = {}

    entry = _TASK_CATALOG_CACHE.get(task, {})
    try:
        return int(entry.get("max_steps", 30))
    except (TypeError, ValueError):
        return 30


BENCHMARK = "telco-rca"


# ── Spec-compliant stdout logging ─────────────────────────────────────
# Format required by OpenEnv evaluator:
#   [START] task=<name> env=<benchmark> model=<model>
#   [STEP]  step=<n> action=<str> reward=<0.00> done=<true|false> error=<msg|null>
#   [END]   success=<true|false> steps=<n> score=<0.00> rewards=<r1,r2,...>

def _fmt_bool(v: bool) -> str:
    return "true" if v else "false"


def log_start(task: str) -> None:
    print(f"[START] task={task} env={BENCHMARK} model={MODEL_NAME}", flush=True)


def log_step_line(step: int, action: str, reward: float, done: bool, error) -> None:
    err_str = "null" if error is None else str(error).replace("\n", " ")
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} "
        f"done={_fmt_bool(done)} error={err_str}",
        flush=True,
    )


def log_end(success: bool, steps: int, score: float, rewards: list[float], episode_result: dict = None) -> None:
    if episode_result:
        print(f"[END] {json.dumps({'results': [episode_result]})}", flush=True)
    else:
        rewards_str = ",".join(f"{r:.2f}" for r in rewards)
        print(
            f"[END] success={_fmt_bool(success)} steps={steps} "
            f"score={score:.4f} rewards={rewards_str}",
            flush=True,
        )


def run_episode(task: str) -> dict:
    """Run one full episode and emit stdout tags for OpenEnv validation."""
    seed = _task_seed(task)
    obs = _post("/reset", {"task": task, "seed": seed})

    prompt_history = []
    rewards_list = []
    step_num = 0
    done = False
    start_time = time.time()
    max_steps = _task_max_steps(task)

    # Emit spec-required [START] line for this episode
    log_start(task)

    info = {}
    trajectory = {
        "task": task,
        "steps_taken": 0,
        "total_reward": 0.0,
        "root_cause_fixed": False,
        "correct_diagnosis": False,
        "false_positives": 0,
        "elapsed_seconds": 0.0,
        "root_cause_id": None,
        "root_cause_layer": None,
        "checked_nodes": [],
        "checked_layers": [],
        "total_nodes": 0,
        "total_layers_alarming": 0,
        "action_log": [],
    }
    root_cause_id = None
    root_cause_layer = None
    last_error = None

    while not done and step_num < max_steps:
        step_num += 1
        action = llm_decide(obs, prompt_history)
        action_type = action.get("action_type", "")
        target_node = action.get("target_node_id", "")
        action_str = f"{action_type}({target_node!r})"

        last_error = None
        try:
            result = _post("/step", {"task": task, "action": action})
            reward = float(result["reward"])
            done = bool(result["done"])
            info = result.get("info", {})
            obs = result["observation"]
            # Capture any action-level error from the environment
            last_error = info.get("error") or info.get("last_action_error")
        except Exception as exc:
            reward = 0.0
            last_error = str(exc)
            done = True

        rewards_list.append(reward)
        prompt_history.append(
            {
                "step": step_num,
                "action_type": action_type,
                "target_node_id": target_node,
                "reward": reward,
                "done": done,
                "steps_remaining": obs.get("steps_remaining"),
                "false_positives": obs.get("false_positives_so_far"),
                "info": info,
            }
        )

        # Emit spec-required [STEP] line
        log_step_line(step_num, action_str, reward, done, last_error)

    # Grade the episode
    trajectory.update(
        {
            "steps_taken": step_num,
            "total_reward": round(sum(rewards_list), 4),
            "root_cause_fixed": bool(info.get("result") == "ROOT_CAUSE_FIXED"),
            "correct_diagnosis": bool(info.get("result") == "CORRECT_DIAGNOSIS"),
            "false_positives": obs.get("false_positives_so_far", 0),
            "elapsed_seconds": round(time.time() - start_time, 2),
        }
    )
    score = 0.001
    breakdown = {}
    try:
        env_state = _get(f"/state?task={task}")
        internal_state = None
        if INTERNAL_API_TOKEN:
            try:
                internal_state = _get(
                    f"/state/internal?task={task}",
                    headers={"X-Admin-Token": INTERNAL_API_TOKEN},
                )
            except Exception:
                internal_state = None

        root_cause_id = (
            env_state.get("root_cause_id")
            or (internal_state.get("root_cause_id") if internal_state else None)
            or info.get("root_cause_id")
        )
        root_cause_layer = (
            env_state.get("root_cause_layer")
            or (internal_state.get("root_cause_layer") if internal_state else None)
            or info.get("root_cause_layer")
        )
        trajectory = {
            "task": task,
            "steps_taken": env_state.get("steps_taken", step_num),
            "total_reward": round(sum(rewards_list), 4),
            "root_cause_fixed": bool(info.get("result") == "ROOT_CAUSE_FIXED"),
            "correct_diagnosis": bool(info.get("result") == "CORRECT_DIAGNOSIS"),
            "false_positives": env_state.get("false_positives", obs.get("false_positives_so_far", 0)),
            "elapsed_seconds": round(time.time() - start_time, 2),
            "root_cause_id": root_cause_id,
            "root_cause_layer": root_cause_layer,
            "checked_nodes": env_state.get("checked_nodes", []),
            "checked_layers": env_state.get("checked_layers", []),
            "total_nodes": env_state.get("total_nodes", 0),
            "total_layers_alarming": env_state.get("total_layers_alarming", 0),
            "action_log": env_state.get("action_log", []),
        }
        grade_resp = _post("/grade", {"task": task, "trajectory": trajectory})
        score = grade_resp.get("score", 0.001)
        breakdown = grade_resp.get("breakdown", {})
    except Exception as e:
        print(f"[DEBUG] Failed to grade: {e}", file=sys.stderr)
        score = 0.001
        breakdown = {}
        root_cause_id = None
        root_cause_layer = None

    success = (
        trajectory.get("root_cause_fixed", False)
        or trajectory.get("correct_diagnosis", False)
    )

    # Ensure score is strictly within (0, 1) as required by the evaluator
    score = max(0.001, min(0.999, float(score)))

    episode_result = {
        "task": task,
        "steps_taken": trajectory["steps_taken"],
        "total_reward": round(sum(rewards_list), 4),
        "root_cause_fixed": trajectory["root_cause_fixed"],
        "correct_diagnosis": trajectory["correct_diagnosis"],
        "false_positives": trajectory["false_positives"],
        "elapsed_seconds": round(time.time() - start_time, 2),
        "root_cause_id": root_cause_id,
        "root_cause_layer": root_cause_layer,
        "score": score,
        "breakdown": breakdown,
        "success": success,
        "rewards": rewards_list,
    }

    # Emit spec-required [END] line for this episode
    log_end(success, step_num, score, rewards_list, episode_result)

    return episode_result


def main():
    # The OpenEnv evaluator sets TASK_NAME to test a specific task.
    # When running locally without TASK_NAME, run all four tasks.
    task = os.environ.get("TASK_NAME", "")
    task_list = os.environ.get("TASKS", "").strip()
    if task:
        tasks = [task]
    elif task_list:
        tasks = [item.strip() for item in task_list.split(",") if item.strip()]
    else:
        tasks = ["easy", "medium", "hard", "extreme"]

    results = []
    for t in tasks:
        # Each episode emits its own [START] ... [STEP]... [END] block
        results.append(run_episode(t))

    average_score = round(sum(r["score"] for r in results) / len(results), 4) if results else 0.001
    print(
        f"[DEBUG] all_tasks_done average_score={average_score:.4f} model={MODEL_NAME}",
        file=sys.stderr,
    )
    return average_score


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[DEBUG] inference failed: {exc}", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
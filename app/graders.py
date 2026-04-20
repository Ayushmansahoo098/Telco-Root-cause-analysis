"""
Graders for the Telco-RCA environment.
Each grader returns a float strictly within (0, 1) — never 0.0 or 1.0.
Graders are deterministic given the same episode trajectory.

Scoring formula (v2 — with intelligence signals):
    base_score          = 1.0 if root cause fixed / correctly diagnosed, else 0.0
    efficiency_mult     = 1 - (steps_taken / max_steps)   — rewards fewer steps
    speed_bonus         = max(0, 1 - sim_time/300)        — rewards speed (MTTR)
    fp_penalty          = false_positives * 0.15           — penalises wrong restarts
    exploration_reward  = [0.0, 0.25] bonus for checking unique, information-rich nodes
    redundancy_penalty  = [0.0, 0.3]  penalty for repeating same nodes / action cycles
    final = clamp(
        efficiency_mult
        + speed_bonus * 0.2
        + exploration_reward
        - fp_penalty
        - redundancy_penalty,
      0, 1)
"""

from .models import TaskConfig, TASK_CONFIGS


# ------------------------------------------------------------------ #
#  Exploration efficiency helpers                                      #
# ------------------------------------------------------------------ #

_LAYER_DEPTH = {
    "power_unit": 0,
    "core_switch": 1,
    "radio_controller": 2,
    "cell_tower": 3,
}


def _compute_exploration_reward(
    *,
    checked_nodes: list[str],
    checked_layers: list[str],
    total_nodes: int,
    total_layers_alarming: int,
) -> float:
    """
    Reward exploring *diverse* layers and a reasonable breadth of the topology.

    1. Layer diversity bonus  — did the agent look at multiple layers?
       Checking ≥3 distinct layers earns full diversity credit (0.10).
    2. Coverage efficiency    — what fraction of nodes did the agent touch
       relative to the total?  A sweet spot (5-30%) earns the most credit.
       Too few checks means guessing; too many means brute force.
    3. Both components are weighted to a max of 0.25 combined.
    """
    if not checked_nodes:
        return 0.0

    unique_nodes = set(checked_nodes)
    unique_layers = set(checked_layers)
    n_unique = len(unique_nodes)

    # ── Layer diversity (max 0.10) ──
    layer_ratio = min(len(unique_layers) / 4.0, 1.0)  # 4 possible layers
    layer_bonus = round(layer_ratio * 0.10, 4)

    # ── Coverage efficiency (max 0.15) ──
    # Ideal coverage: between 5% and 30% of the network.
    # Below 5% → too aggressive (guessing).  Above 30% → brute force.
    if total_nodes == 0:
        coverage_bonus = 0.0
    else:
        coverage_frac = n_unique / total_nodes
        if coverage_frac < 0.05:
            # Under-explored: partial credit
            coverage_bonus = round(coverage_frac / 0.05 * 0.08, 4)
        elif coverage_frac <= 0.30:
            # Sweet spot — full credit
            coverage_bonus = 0.15
        else:
            # Over-explored — decaying credit (brute force)
            decay = max(0.0, 1.0 - (coverage_frac - 0.30) / 0.40)
            coverage_bonus = round(decay * 0.15, 4)

    return round(min(0.25, layer_bonus + coverage_bonus), 4)


def _compute_redundancy_penalty(
    *,
    action_log: list[dict],
    checked_nodes: list[str],
) -> float:
    """
    Penalise wasteful, repetitive behaviour.

    Signals detected:
    1. Re-checking the same node with the same action type.
    2. Cycling: performing the exact same (action, node) pair ≥3 times.
    3. Checking already-restarted/diagnosed nodes redundantly.

    Max penalty capped at 0.30 to avoid completely zeroing out a
    correct final answer.
    """
    if not action_log:
        return 0.0

    # Build (action_type, target_node) frequency map
    pair_counts: dict[tuple[str, str], int] = {}
    for entry in action_log:
        key = (entry.get("action_type", ""), entry.get("target_node_id", ""))
        pair_counts[key] = pair_counts.get(key, 0) + 1

    # Count pure duplicate actions (same action+target, executed >1 time)
    duplicate_actions = sum(max(0, count - 1) for count in pair_counts.values())

    # Count cycling: pairs that appear ≥ 3 times
    cycling_pairs = sum(1 for count in pair_counts.values() if count >= 3)

    # Penalty: 0.03 per duplicate action, + 0.05 per cycling pair
    raw_penalty = duplicate_actions * 0.03 + cycling_pairs * 0.05

    return round(min(0.30, raw_penalty), 4)


def grade_episode(
    *,
    task_name: str,
    root_cause_fixed: bool,
    steps_taken: int,
    false_positives: int,
    elapsed_seconds: float,
    correct_diagnosis: bool = False,
    # ── New intelligence signals (optional for backward compat) ──
    checked_nodes: list[str] | None = None,
    checked_layers: list[str] | None = None,
    total_nodes: int = 0,
    total_layers_alarming: int = 0,
    action_log: list[dict] | None = None,
) -> dict:
    """
    Unified grader (v2). Returns a score strictly in (0, 1) and a breakdown dict.

    The score rewards:
      - Correctness:  finding the actual root cause (F1 component)
      - Efficiency:   using fewer steps (fewer unnecessary checks)
      - Speed:        faster resolution (MTTR bonus via simulation time)
      - Precision:    not sending crews to wrong locations (FP penalty)
      - Exploration:  checking diverse, informative nodes (new)
      - Conciseness:  not repeating redundant actions (new)
    """
    cfg: TaskConfig = TASK_CONFIGS[task_name]

    # ── F1-style root cause accuracy ──
    tp = 1.0 if (root_cause_fixed or correct_diagnosis) else 0.0
    fp = float(false_positives)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp  # Only one root cause, so recall = 1 if found
    f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    # ── Intelligence signals ──
    exploration_reward = _compute_exploration_reward(
        checked_nodes=checked_nodes or [],
        checked_layers=checked_layers or [],
        total_nodes=total_nodes,
        total_layers_alarming=total_layers_alarming,
    )
    redundancy_penalty = _compute_redundancy_penalty(
        action_log=action_log or [],
        checked_nodes=checked_nodes or [],
    )

    if not (root_cause_fixed or correct_diagnosis):
        return {
            "score": 0.001,
            "reason": "Root cause not identified within episode budget.",
            "breakdown": {
                "base": 0.0,
                "f1_score": 0.0,
                "efficiency_mult": 0.0,
                "speed_bonus": 0.0,
                "fp_penalty": round(min(0.8, false_positives * 0.15), 4),
                "exploration_reward": round(exploration_reward, 4),
                "redundancy_penalty": round(redundancy_penalty, 4),
                "precision": 0.0,
                "recall": 0.0,
                "steps_used": steps_taken,
                "max_steps": cfg.max_steps,
                "elapsed_seconds": round(elapsed_seconds, 2),
                "unique_nodes_checked": len(set(checked_nodes)) if checked_nodes else 0,
                "unique_layers_checked": len(set(checked_layers)) if checked_layers else 0,
                "duplicate_actions": sum(
                    max(0, c - 1) for c in _action_pair_counts(action_log or []).values()
                ),
            },
        }

    efficiency = max(0.0, 1.0 - steps_taken / cfg.max_steps)
    speed_bonus = max(0.0, 1.0 - elapsed_seconds / 300.0)  # wall-clock intentional for MTTR
    fp_penalty = min(0.8, false_positives * 0.15)

    # ── Composite score ──
    # base × efficiency  →  fast, correct solves
    # + speed bonus      →  low MTTR
    # + exploration      →  intelligent traversal
    # - fp penalty       →  wrong restarts/diagnoses
    # - redundancy       →  repetitive actions
    # f1_score is in breakdown for reporting only; it does not affect the final score
    raw = (
        efficiency
        + speed_bonus * 0.2
        + exploration_reward
        - fp_penalty
        - redundancy_penalty
    )
    score = round(max(0.001, min(0.999, raw)), 4)

    return {
        "score": score,
        "reason": "Root cause correctly identified.",
        "breakdown": {
            "base": 1.0,
            "f1_score": round(f1_score, 4),
            "efficiency_mult": round(efficiency, 4),
            "speed_bonus": round(speed_bonus * 0.2, 4),
            "fp_penalty": round(fp_penalty, 4),
            "exploration_reward": round(exploration_reward, 4),
            "redundancy_penalty": round(redundancy_penalty, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "steps_used": steps_taken,
            "max_steps": cfg.max_steps,
            "elapsed_seconds": round(elapsed_seconds, 2),
            "unique_nodes_checked": len(set(checked_nodes)) if checked_nodes else 0,
            "unique_layers_checked": len(set(checked_layers)) if checked_layers else 0,
            "duplicate_actions": sum(
                max(0, c - 1) for c in _action_pair_counts(action_log or []).values()
            ),
        },
    }


def _action_pair_counts(action_log: list[dict]) -> dict[tuple[str, str], int]:
    """Helper: frequency map of (action_type, target) pairs."""
    counts: dict[tuple[str, str], int] = {}
    for entry in action_log:
        key = (entry.get("action_type", ""), entry.get("target_node_id", ""))
        counts[key] = counts.get(key, 0) + 1
    return counts


# ------------------------------------------------------------------ #
#  Convenience wrappers (unchanged API for backward compat)            #
# ------------------------------------------------------------------ #

def grade_easy(trajectory: dict) -> float:
    result = grade_episode(
        task_name="easy",
        root_cause_fixed=trajectory.get("root_cause_fixed", False),
        steps_taken=trajectory.get("steps_taken", 15),
        false_positives=trajectory.get("false_positives", 0),
        elapsed_seconds=trajectory.get("elapsed_seconds", 300),
        correct_diagnosis=trajectory.get("correct_diagnosis", False),
        checked_nodes=trajectory.get("checked_nodes"),
        checked_layers=trajectory.get("checked_layers"),
        total_nodes=trajectory.get("total_nodes", 0),
        total_layers_alarming=trajectory.get("total_layers_alarming", 0),
        action_log=trajectory.get("action_log"),
    )
    return result["score"]


def grade_medium(trajectory: dict) -> float:
    result = grade_episode(
        task_name="medium",
        root_cause_fixed=trajectory.get("root_cause_fixed", False),
        steps_taken=trajectory.get("steps_taken", 30),
        false_positives=trajectory.get("false_positives", 0),
        elapsed_seconds=trajectory.get("elapsed_seconds", 300),
        correct_diagnosis=trajectory.get("correct_diagnosis", False),
        checked_nodes=trajectory.get("checked_nodes"),
        checked_layers=trajectory.get("checked_layers"),
        total_nodes=trajectory.get("total_nodes", 0),
        total_layers_alarming=trajectory.get("total_layers_alarming", 0),
        action_log=trajectory.get("action_log"),
    )
    return result["score"]


def grade_hard(trajectory: dict) -> float:
    result = grade_episode(
        task_name="hard",
        root_cause_fixed=trajectory.get("root_cause_fixed", False),
        steps_taken=trajectory.get("steps_taken", 50),
        false_positives=trajectory.get("false_positives", 0),
        elapsed_seconds=trajectory.get("elapsed_seconds", 300),
        correct_diagnosis=trajectory.get("correct_diagnosis", False),
        checked_nodes=trajectory.get("checked_nodes"),
        checked_layers=trajectory.get("checked_layers"),
        total_nodes=trajectory.get("total_nodes", 0),
        total_layers_alarming=trajectory.get("total_layers_alarming", 0),
        action_log=trajectory.get("action_log"),
    )
    return result["score"]


def grade_extreme(trajectory: dict) -> float:
    result = grade_episode(
        task_name="extreme",
        root_cause_fixed=trajectory.get("root_cause_fixed", False),
        steps_taken=trajectory.get("steps_taken", 75),
        false_positives=trajectory.get("false_positives", 0),
        elapsed_seconds=trajectory.get("elapsed_seconds", 300),
        correct_diagnosis=trajectory.get("correct_diagnosis", False),
        checked_nodes=trajectory.get("checked_nodes"),
        checked_layers=trajectory.get("checked_layers"),
        total_nodes=trajectory.get("total_nodes", 0),
        total_layers_alarming=trajectory.get("total_layers_alarming", 0),
        action_log=trajectory.get("action_log"),
    )
    return result["score"]
"""
Telco-RCA Environment: Root Cause Analysis for 5G Network Failures
===================================================================

Simulates cascading alarm storms in a realistic telecom network topology.
The agent must identify the true root cause node among hundreds or thousands
of symptom alarms, navigating a layered knowledge graph of physical and
logical dependencies.

Supported difficulty tiers: easy, medium, hard, and extreme.
The extreme tier is designed for advanced agents requiring multi-hop
reasoning under heavy noise.

Topology:  Power Units → Core Switches → Radio Controllers → Cell Towers
Failure model: when a parent node fails, ALL downstream children emit
symptom alarms. Noise alarms (transient/spurious) are injected at a
configurable ratio to confound diagnosis.

Key features:
  - Hierarchical 4-layer topology with realistic branching factors
  - Region-based clustering (nodes grouped by geographic region)
  - Parent tracking for upward traversal
  - Realistic alarm text templates with telco-specific terminology
  - Physical diagnostics (voltage, temperature, uptime)
  - TRACE_PATH action for inspecting parent–child relationships
  - Deterministic grading via F1 + MTTR scoring
"""

import random
import time
from typing import Any
from collections import deque, Counter

from .models import (
    NetworkNode, Alarm, AgentObservation, AgentAction,
    StepResult, EpisodeState, TaskConfig, TASK_CONFIGS, Severity,
    TrajectoryNodeHeatmap, TrajectoryResponse, TrajectoryStep,
)


class TelcoRCAEnvironment:
    """
    Simulates a 5G network where equipment failures propagate as alarm cascades.

    Topology: Power Units → Core Switches → Radio Controllers → Cell Towers
    When a parent fails, all downstream children generate symptom alarms.
    Agent must diagnose the root cause without sending unnecessary repair crews.
    Includes an extreme tier for advanced multi-hop reasoning under heavy noise.
    """
    ACTION_TIME_COST_S: dict[str, float] = {
        "CHECK_LOGS": 8.0,
        "CHECK_VOLTAGE": 6.0,
        "TRACE_PATH": 5.0,
        "RESTART": 15.0,
        "DIAGNOSE": 4.0,
    }
    MAX_FALSE_POSITIVE_PENALTY: float = 0.8
    SEVERITY_ORDER: list[Severity] = ["MINOR", "WARNING", "MAJOR", "CRITICAL"]
    ESCALATION_INTERVAL_S: dict[str, float] = {
        "easy": 120.0,
        "medium": 75.0,
        "hard": 45.0,
        "extreme": 35.0,
    }
    NOISE_TTL_S: dict[str, float] = {
        "easy": 45.0,
        "medium": 60.0,
        "hard": 50.0,
        "extreme": 65.0,
    }
    NOISE_SPAWN_PROB: dict[str, float] = {
        "easy": 0.0,
        "medium": 0.08,
        "hard": 0.15,
        "extreme": 0.22,
    }

    def __init__(self, task_name: str = "easy"):
        if task_name not in TASK_CONFIGS:
            raise ValueError(f"Unknown task: {task_name}. Choose from {list(TASK_CONFIGS.keys())}")
        self.task_config: TaskConfig = TASK_CONFIGS[task_name]
        self.task_name = task_name
        self._state: EpisodeState | None = None
        self._start_time: float = 0.0

    # ------------------------------------------------------------------ #
    #  Public OpenEnv interface                                            #
    # ------------------------------------------------------------------ #

    def reset(self, seed: int | None = None) -> AgentObservation:
        """Initialise a fresh episode with a new random failure injected."""
        if seed is not None:
            random.seed(seed)

        cfg = self.task_config
        nodes, edges, regions = self._build_topology(cfg.num_nodes, cfg.num_regions)
        root_cause_id = self._inject_failure(nodes, cfg)
        initial_alarms = self._propagate_alarms(nodes, root_cause_id, cfg)

        self._state = EpisodeState(
            nodes=nodes,
            root_cause_id=root_cause_id,
            active_alarms=initial_alarms,
            checked_nodes=set(),
            restarted_nodes=set(),
            diagnosed_nodes=set(),
            steps_taken=0,
            max_steps=cfg.max_steps,
            false_positives=0,
            episode_done=False,
            start_time=time.time(),
            simulation_time_s=0.0,
            last_step_advanced_s=0.0,
            alarm_seq=len(initial_alarms),
            topology_edges=edges,
            regions=regions,
            trajectory_log=[],
        )
        self._start_time = time.time()
        return self._build_observation()

    def step(self, action: AgentAction) -> StepResult:
        """Execute one agent action and return (observation, reward, done, info)."""
        if self._state is None:
            raise RuntimeError("Call reset() before step()")
        if self._state.episode_done:
            raise RuntimeError("Episode is done. Call reset() to start a new one.")

        s = self._state
        s.steps_taken += 1
        reward = -0.01  # small step penalty encourages efficiency
        info: dict[str, Any] = {}

        # Record action for grading intelligence signals
        action_entry = {
            "step": s.steps_taken,
            "action_type": action.action_type,
            "target_node_id": action.target_node_id,
            "simulation_time_s": round(s.simulation_time_s, 2),
        }
        s.action_log.append(action_entry)
        advanced_s = self._advance_simulation_clock(action.action_type)
        s.last_step_advanced_s = advanced_s

        if action.action_type == "CHECK_LOGS":
            reward, info = self._handle_check(action.target_node_id)
        elif action.action_type == "CHECK_VOLTAGE":
            reward, info = self._handle_voltage(action.target_node_id)
        elif action.action_type == "TRACE_PATH":
            reward, info = self._handle_trace_path(action.target_node_id)
        elif action.action_type == "RESTART":
            reward, info = self._handle_restart(action.target_node_id)
        elif action.action_type == "DIAGNOSE":
            reward, info = self._handle_diagnose(action.target_node_id)
        else:
            reward = -0.1
            info["error"] = f"Unknown action: {action.action_type}"
            info["reward_breakdown"] = {"invalid_action_penalty": round(reward, 4)}

        # Evolve alarms over simulated time (escalation/noise lifecycle).
        if not s.episode_done:
            self._evolve_alarms()

        # Check termination conditions
        if s.steps_taken >= s.max_steps and not s.episode_done:
            s.episode_done = True
            info["termination"] = "max_steps_exceeded"
        info["simulation_time_s"] = round(s.simulation_time_s, 2)
        info["time_advanced_s"] = round(advanced_s, 2)

        action_entry.update(
            {
                "reward": round(reward, 4),
                "result": info.get("result"),
                "time_advanced_s": round(advanced_s, 2),
                "reward_breakdown": info.get("reward_breakdown", {}),
            }
        )
        self._append_trajectory_step(action, reward, info, advanced_s)

        obs = self._build_observation()
        return StepResult(
            observation=obs,
            reward=round(reward, 4),
            done=s.episode_done,
            info=info,
        )

    def state(self, include_answer_key: bool = False) -> dict:
        """Return current episode state, optionally including the hidden answer key."""
        if self._state is None:
            return {"status": "not_started"}
        s = self._state

        # Compute checked layers for grading
        checked_layers = [
            s.nodes[nid].layer for nid in s.checked_nodes if nid in s.nodes
        ]
        # Count layers with active alarms
        layers_alarming = len(set(
            node.layer for node in s.nodes.values() if node.status != "UP"
        ))
        root_cause_fixed = s.root_cause_id in s.restarted_nodes
        correct_diagnosis = s.root_cause_id in s.diagnosed_nodes
        payload = {
            "steps_taken": s.steps_taken,
            "false_positives": s.false_positives,
            "episode_done": s.episode_done,
            "checked_nodes": list(s.checked_nodes),
            "checked_layers": checked_layers,
            "restarted_nodes": list(s.restarted_nodes),
            "diagnosed_nodes": list(s.diagnosed_nodes),
            "active_alarm_count": len(s.active_alarms),
            "total_nodes": len(s.nodes),
            "total_layers_alarming": layers_alarming,
            "elapsed_seconds": round(time.time() - s.start_time, 2),
            "simulation_time_s": round(s.simulation_time_s, 2),
            "last_step_advanced_s": round(s.last_step_advanced_s, 2),
            "topology_edge_count": len(s.topology_edges),
            "regions": {k: len(v) for k, v in s.regions.items()},
            "action_log": s.action_log,
            "root_cause_fixed": root_cause_fixed,
            "correct_diagnosis": correct_diagnosis,
            "resolved_node_id": s.root_cause_id if s.episode_done and (root_cause_fixed or correct_diagnosis) else None,
        }

        if include_answer_key:
            payload["root_cause_id"] = s.root_cause_id
            payload["root_cause_layer"] = s.nodes[s.root_cause_id].layer

        return payload

    def trajectory(self) -> dict:
        """Return a structured trajectory payload for visualization."""
        if self._state is None:
            return {"status": "not_started"}

        s = self._state
        checked_layers = [
            s.nodes[nid].layer for nid in s.checked_nodes if nid in s.nodes
        ]

        node_visit_weights: Counter[str] = Counter()
        node_first_seen: dict[str, int] = {}
        node_last_seen: dict[str, int] = {}
        path_nodes: list[str] = []
        seen_path_nodes: set[str] = set()
        path_segments: list[dict[str, Any]] = []
        reward_series: list[dict[str, Any]] = []
        step_log: list[TrajectoryStep] = []
        cumulative_reward = 0.0

        for entry in s.trajectory_log:
            step = int(entry.get("step", 0))
            reward = float(entry.get("reward", 0.0))
            cumulative_reward += reward

            raw_path = entry.get("path_nodes") or [entry.get("target_node_id")]
            normalized_path = [node_id for node_id in raw_path if node_id in s.nodes]

            step_log.append(TrajectoryStep(
                step=step,
                action_type=entry.get("action_type", "CHECK_LOGS"),
                target_node_id=entry.get("target_node_id", ""),
                target_layer=entry.get("target_layer"),
                target_region=entry.get("target_region"),
                simulation_time_s=float(entry.get("simulation_time_s", 0.0)),
                time_advanced_s=float(entry.get("time_advanced_s", 0.0)),
                reward=reward,
                reward_breakdown=entry.get("reward_breakdown", {}),
                result=entry.get("result"),
                path_nodes=normalized_path,
                false_positives_total=int(entry.get("false_positives_total", 0)),
                done=bool(entry.get("done", False)),
            ))

            reward_series.append({
                "step": step,
                "action_type": entry.get("action_type", ""),
                "target_node_id": entry.get("target_node_id", ""),
                "simulation_time_s": float(entry.get("simulation_time_s", 0.0)),
                "time_advanced_s": float(entry.get("time_advanced_s", 0.0)),
                "reward": round(reward, 4),
                "cumulative_reward": round(cumulative_reward, 4),
                "reward_breakdown": entry.get("reward_breakdown", {}),
                "result": entry.get("result"),
            })

            if normalized_path and (len(normalized_path) > 1 or entry.get("action_type") == "TRACE_PATH"):
                path_segments.append({
                    "step": step,
                    "action_type": entry.get("action_type", ""),
                    "target_node_id": entry.get("target_node_id", ""),
                    "nodes": normalized_path,
                    "simulation_time_s": float(entry.get("simulation_time_s", 0.0)),
                    "time_advanced_s": float(entry.get("time_advanced_s", 0.0)),
                    "reward": round(reward, 4),
                })

            for index, node_id in enumerate(normalized_path):
                node_visit_weights[node_id] += 1.0 if index == 0 else 0.65
                node_first_seen.setdefault(node_id, step)
                node_last_seen[node_id] = step
                if node_id not in seen_path_nodes:
                    seen_path_nodes.add(node_id)
                    path_nodes.append(node_id)

        if not path_nodes:
            path_nodes = list(s.checked_nodes)

        alarm_source_ids = {alarm.node_id for alarm in s.active_alarms}
        if s.root_cause_id in s.nodes:
            alarm_source_ids.add(s.root_cause_id)

        heatmap: list[TrajectoryNodeHeatmap] = []
        total_steps = max(1, len(s.trajectory_log))
        for node_id, visit_score in sorted(node_visit_weights.items(), key=lambda item: (-item[1], item[0])):
            node = s.nodes[node_id]
            heatmap.append(TrajectoryNodeHeatmap(
                node_id=node_id,
                layer=node.layer,
                region=node.region,
                status_name=node.status,
                visit_count=round(visit_score, 2),
                first_seen_step=node_first_seen.get(node_id, 0),
                last_seen_step=node_last_seen.get(node_id, 0),
                is_checked=node_id in s.checked_nodes,
                is_alarm_source=node_id in alarm_source_ids,
                intensity=round(min(1.0, visit_score / total_steps), 4),
            ))

        reward_breakdown_summary: dict[str, float] = {}
        for entry in s.trajectory_log:
            for key, value in (entry.get("reward_breakdown") or {}).items():
                if isinstance(value, (int, float)):
                    reward_breakdown_summary[key] = round(
                        reward_breakdown_summary.get(key, 0.0) + float(value),
                        4,
                    )

        total_reward = round(sum(item.reward for item in step_log), 4)
        payload = TrajectoryResponse(
            task=self.task_name,
            episode_done=s.episode_done,
            total_steps=s.steps_taken,
            elapsed_seconds=round(time.time() - s.start_time, 2),
            simulation_time_s=round(s.simulation_time_s, 2),
            total_reward=total_reward,
            unique_nodes_checked=len(set(s.checked_nodes)),
            unique_layers_checked=len(set(checked_layers)),
            path_nodes=path_nodes,
            path_segments=path_segments,
            reward_series=reward_series,
            step_log=step_log,
            heatmap=heatmap,
            graph=self._build_graph_observation(),
            summary={
                "false_positives": s.false_positives,
                "root_cause_fixed": s.root_cause_id in s.restarted_nodes,
                "correct_diagnosis": s.root_cause_id in s.diagnosed_nodes,
                "checked_nodes": list(s.checked_nodes),
                "checked_layers": checked_layers,
                "reward_breakdown_summary": reward_breakdown_summary,
                "path_segment_count": len(path_segments),
                "heatmap_size": len(heatmap),
            },
        )
        return payload.model_dump()

    def _append_trajectory_step(self, action: AgentAction, reward: float, info: dict, advanced_s: float):
        """Persist a structured step record for the trajectory visualization endpoint."""
        s = self._state
        if s is None:
            return

        node = s.nodes.get(action.target_node_id)
        raw_path = info.get("path_to_root") or []
        path_nodes = [
            item.get("node_id") if isinstance(item, dict) else item
            for item in raw_path
            if item
        ]
        if not path_nodes and action.target_node_id in s.nodes:
            path_nodes = [action.target_node_id]

        s.trajectory_log.append({
            "step": s.steps_taken,
            "action_type": action.action_type,
            "target_node_id": action.target_node_id,
            "target_layer": node.layer if node else None,
            "target_region": node.region if node else None,
            "simulation_time_s": round(s.simulation_time_s, 2),
            "time_advanced_s": round(advanced_s, 2),
            "reward": round(reward, 4),
            "reward_breakdown": info.get("reward_breakdown", {"total": round(reward, 4)}),
            "result": info.get("result"),
            "path_nodes": path_nodes,
            "false_positives_total": s.false_positives,
            "done": s.episode_done,
        })

    # ------------------------------------------------------------------ #
    #  Topology & failure simulation                                       #
    # ------------------------------------------------------------------ #

    def _build_topology(
        self, num_nodes: int, num_regions: int = 1
    ) -> tuple[dict[str, NetworkNode], list[tuple[str, str]], dict[str, list[str]]]:
        """
        Build a layered 5G network topology with region clustering.

        Layers:
          0 - Power Units   (roots) — ~1 per 20 nodes
          1 - Core Switches         — 2–4 per power unit
          2 - Radio Controllers     — 2–5 per switch
          3 - Cell Towers           — fill remaining quota

        Returns:
            (nodes_dict, edge_list, region_dict)
        """
        if num_nodes > 1500:
            raise ValueError("num_nodes too large — may cause performance issues")

        nodes: dict[str, NetworkNode] = {}
        edges: list[tuple[str, str]] = []
        regions: dict[str, list[str]] = {f"region_{i}": [] for i in range(num_regions)}
        region_names = list(regions.keys())
        layer_counts = self._plan_layer_counts(num_nodes)

        # ── Layer 0: Power Units ──
        n_power = layer_counts["power_unit"]
        for i in range(n_power):
            nid = f"PWR_{i:03d}"
            region = region_names[i % num_regions]
            nodes[nid] = NetworkNode(
                node_id=nid, layer="power_unit",
                children=[], parent_id=None, status="UP",
                alarm_text=None, region=region,
                voltage=48.0, temperature_c=round(random.uniform(28, 42), 1),
                uptime_hours=round(random.uniform(100, 20000), 1),
            )
            regions[region].append(nid)

        # ── Layer 1: Core Switches ──
        power_ids = sorted(nid for nid, node in nodes.items() if node.layer == "power_unit")
        switch_slots = {power_id: 0 for power_id in power_ids}
        for parent_id in self._expand_parent_ids(power_ids, layer_counts["core_switch"]):
            slot = switch_slots[parent_id]
            switch_slots[parent_id] += 1
            power_idx = int(parent_id.split("_")[1])
            nid = f"SW_{power_idx:02d}_{slot:02d}"
            region = nodes[parent_id].region
            nodes[nid] = NetworkNode(
                node_id=nid, layer="core_switch",
                children=[], parent_id=parent_id, status="UP",
                alarm_text=None, region=region,
                voltage=48.0, temperature_c=round(random.uniform(30, 55), 1),
                uptime_hours=round(random.uniform(100, 15000), 1),
            )
            nodes[parent_id].children.append(nid)
            edges.append((parent_id, nid))
            regions[region].append(nid)

        # ── Layer 2: Radio Controllers ──
        switches = sorted(nid for nid, node in nodes.items() if node.layer == "core_switch")
        rc_slots = {switch_id: 0 for switch_id in switches}
        for sw_id in self._expand_parent_ids(switches, layer_counts["radio_controller"]):
            rc_idx = rc_slots[sw_id]
            rc_slots[sw_id] += 1
            nid = f"RC_{sw_id[3:]}_{rc_idx:02d}"
            region = nodes[sw_id].region
            nodes[nid] = NetworkNode(
                node_id=nid, layer="radio_controller",
                children=[], parent_id=sw_id, status="UP",
                alarm_text=None, region=region,
                voltage=48.0, temperature_c=round(random.uniform(35, 65), 1),
                uptime_hours=round(random.uniform(100, 12000), 1),
            )
            nodes[sw_id].children.append(nid)
            edges.append((sw_id, nid))
            regions[region].append(nid)

        # ── Layer 3: Cell Towers — fill remaining quota exactly ──
        rcs = sorted(nid for nid, node in nodes.items() if node.layer == "radio_controller")
        tower_slots = {rc_id: 0 for rc_id in rcs}
        for rc_id in self._expand_parent_ids(rcs, layer_counts["cell_tower"]):
            tower_idx = tower_slots[rc_id]
            tower_slots[rc_id] += 1
            nid = f"TOWER_{rc_id[3:]}_{tower_idx:02d}"
            region = nodes[rc_id].region
            nodes[nid] = NetworkNode(
                node_id=nid, layer="cell_tower",
                children=[], parent_id=rc_id, status="UP",
                alarm_text=None, region=region,
                voltage=48.0, temperature_c=round(random.uniform(20, 50), 1),
                uptime_hours=round(random.uniform(50, 10000), 1),
            )
            nodes[rc_id].children.append(nid)
            edges.append((rc_id, nid))
            regions[region].append(nid)

        return nodes, edges, regions

    def _plan_layer_counts(self, num_nodes: int) -> dict[str, int]:
        """Allocate exact per-layer node counts while preserving a realistic shape."""
        if num_nodes < 4:
            raise ValueError("Topology requires at least 4 nodes to represent all layers.")

        power_units = max(1, min(num_nodes - 3, num_nodes // 20))
        remaining_after_power = num_nodes - power_units

        core_switch_target = max(power_units * 2, round(num_nodes * 0.17))
        core_switches = min(max(1, remaining_after_power - 2), core_switch_target)
        remaining_after_switches = num_nodes - power_units - core_switches

        radio_target = max(core_switches, round(num_nodes * 0.34))
        radio_controllers = min(
            max(1, remaining_after_switches - 1),
            max(1, remaining_after_switches // 2),
            radio_target,
        )
        cell_towers = num_nodes - power_units - core_switches - radio_controllers

        if cell_towers < radio_controllers:
            transferable = min(radio_controllers - core_switches, radio_controllers - cell_towers)
            radio_controllers -= max(0, transferable)
            cell_towers = num_nodes - power_units - core_switches - radio_controllers

        return {
            "power_unit": power_units,
            "core_switch": core_switches,
            "radio_controller": radio_controllers,
            "cell_tower": cell_towers,
        }

    def _expand_parent_ids(self, parent_ids: list[str], child_count: int) -> list[str]:
        """Distribute children across parents while keeping each parent represented."""
        if not parent_ids or child_count <= 0:
            return []

        ordered_parents = list(parent_ids)
        assigned_parents: list[str] = []
        random.shuffle(ordered_parents)

        while len(assigned_parents) < child_count:
            if len(assigned_parents) % len(ordered_parents) == 0:
                random.shuffle(ordered_parents)
            parent_id = ordered_parents[len(assigned_parents) % len(ordered_parents)]
            assigned_parents.append(parent_id)

        return assigned_parents

    def _inject_failure(self, nodes: dict[str, NetworkNode], cfg: TaskConfig) -> str:
        """Pick a root cause node and mark it as FAILED with realistic diagnostics."""
        candidates = [
            nid for nid, n in nodes.items()
            if n.layer in cfg.failure_layers
        ]
        root_cause_id = random.choice(candidates)
        node = nodes[root_cause_id]
        node.status = "FAILED"
        node.voltage = round(random.uniform(8.0, 22.0), 1)
        node.temperature_c = round(random.uniform(75, 110), 1)

        # Generate a rich, layer-specific root cause alarm
        root_alarm_templates = {
            "power_unit": [
                f"CRITICAL: MAINS FAILURE — AC input lost on all phases. "
                f"UPS battery draining at {node.voltage}V. Estimated runtime: "
                f"{max(1, int(node.voltage / 4))} minutes. Rectifier offline. "
                f"Generator auto-transfer FAILED.",
                f"CRITICAL: DC power bus voltage collapsed to {node.voltage}V "
                f"(nominal 48V). Thermal runaway detected at {node.temperature_c}°C. "
                f"Battery bank disconnected. All downstream loads at risk.",
            ],
            "core_switch": [
                f"CRITICAL: Fabric switch ASIC failure on slot 3. "
                f"All line cards isolated. BGP/OSPF sessions torn down. "
                f"Voltage drooping to {node.voltage}V. CPU temperature {node.temperature_c}°C.",
                f"CRITICAL: Backplane communication lost. "
                f"CRC error storm: 142,000 errors/sec. Port channels flapping. "
                f"Voltage: {node.voltage}V.",
            ],
            "radio_controller": [
                f"CRITICAL: BBU hardware fault. CPRI links to all RRUs lost. "
                f"Baseband processing halted. Voltage: {node.voltage}V. "
                f"Temperature: {node.temperature_c}°C. No handover capacity.",
                f"CRITICAL: GPS timing reference lost AND internal oscillator failed. "
                f"All cells desynchronised. CPRI frame alignment errors. "
                f"Voltage: {node.voltage}V.",
            ],
        }
        templates = root_alarm_templates.get(node.layer, [
            f"CRITICAL: Hardware fault on {node.layer}. Voltage: {node.voltage}V"
        ])
        node.alarm_text = random.choice(templates)

        return root_cause_id

    def _propagate_alarms(
        self, nodes: dict[str, NetworkNode], root_id: str, cfg: TaskConfig
    ) -> list[Alarm]:
        """
        BFS from root cause — downstream nodes emit symptom alarms.
        Also adds adversarial clustered noise on non-affected nodes.
        """
        alarms: list[Alarm] = []
        queue = deque((child_id, 1, 0.0) for child_id in nodes[root_id].children)
        visited = {root_id}
        severity_cycle = ["WARNING", "MAJOR", "CRITICAL", "MINOR"]
        alarm_counter = 0
        sim_zero = 0.0

        # Root cause's own alarm
        alarms.append(Alarm(
            alarm_id=f"ALM_{alarm_counter:05d}",
            node_id=root_id,
            severity="CRITICAL",
            message=nodes[root_id].alarm_text or "CRITICAL: Hardware fault",
            layer=nodes[root_id].layer,
            timestamp=sim_zero,
            is_noise=False,
            created_at_s=sim_zero,
            last_updated_at_s=sim_zero,
            age_s=0.0,
            depth_from_root=0,
            propagation_delay_s=0.0,
            escalation_count=0,
            source="root_cause",
        ))
        alarm_counter += 1

        # Propagate downstream
        while queue:
            nid, depth, parent_alarm_time = queue.popleft()
            if nid in visited:
                continue
            visited.add(nid)
            node = nodes[nid]
            node.status = "DEGRADED"
            node.voltage = round(random.uniform(25.0, 40.0), 1)

            sev = random.choice(severity_cycle)
            alarm_text = self._generate_alarm_text(node.layer, sev)
            node.alarm_text = alarm_text
            propagation_delay = self._sample_propagation_delay_s(node.layer, depth)
            alarm_time = round(parent_alarm_time + propagation_delay, 2)

            alarms.append(Alarm(
                alarm_id=f"ALM_{alarm_counter:05d}",
                node_id=nid,
                severity=sev,
                message=alarm_text,
                layer=node.layer,
                timestamp=alarm_time,
                is_noise=False,
                created_at_s=alarm_time,
                last_updated_at_s=alarm_time,
                age_s=0.0,
                depth_from_root=depth,
                propagation_delay_s=propagation_delay,
                escalation_count=0,
                source="cascade",
            ))
            alarm_counter += 1

            queue.extend(
                (child_id, depth + 1, alarm_time)
                for child_id in nodes[nid].children
            )

        if cfg.noise_ratio > 0:
            noise_alarms, alarm_counter = self._build_adversarial_noise_clusters(
                nodes=nodes,
                blocked_nodes=visited,
                cfg=cfg,
                starting_alarm_counter=alarm_counter,
            )
            alarms.extend(noise_alarms)

        alarms.sort(key=lambda alarm: alarm.timestamp)
        return alarms

    def _build_adversarial_noise_clusters(
        self,
        *,
        nodes: dict[str, NetworkNode],
        blocked_nodes: set[str],
        cfg: TaskConfig,
        starting_alarm_counter: int,
    ) -> tuple[list[Alarm], int]:
        """
        Build fake incident clusters on unaffected subtrees so noise resembles a
        plausible local outage rather than isolated, trivially filtered blips.
        """
        candidate_ids = [
            nid for nid, node in nodes.items()
            if nid not in blocked_nodes and node.layer != "power_unit"
        ]
        if not candidate_ids:
            return [], starting_alarm_counter

        target_noise = max(2, int(len(candidate_ids) * cfg.noise_ratio * 0.18))
        noise_alarms: list[Alarm] = []
        used_nodes: set[str] = set()
        alarm_counter = starting_alarm_counter
        if self.task_name == "medium":
            max_cluster_size = 3
        elif self.task_name == "extreme":
            max_cluster_size = 8
        else:
            max_cluster_size = 6

        while len(noise_alarms) < target_noise:
            available_anchors = [
                nid for nid in candidate_ids
                if nid not in used_nodes and self._noise_cluster_capacity(nodes, nid, blocked_nodes | used_nodes) >= 2
            ]
            if not available_anchors:
                break

            anchor_id = self._choose_noise_anchor(nodes, available_anchors)
            remaining = target_noise - len(noise_alarms)
            cluster_size = min(max_cluster_size, remaining)
            cluster_nodes = self._collect_noise_cluster_nodes(
                nodes=nodes,
                anchor_id=anchor_id,
                blocked_nodes=blocked_nodes | used_nodes,
                cluster_size=cluster_size,
            )
            if len(cluster_nodes) < 2:
                used_nodes.add(anchor_id)
                continue

            cluster_start_s = round(random.uniform(1.5, 18.0), 2)
            for idx, node_id in enumerate(cluster_nodes):
                node = nodes[node_id]
                severity = self._sample_cluster_noise_severity(node.layer, idx)
                alarm_time = round(cluster_start_s + idx * random.uniform(0.35, 2.2), 2)
                alarm_text = self._generate_alarm_text(node.layer, severity)

                # Mark clustered noise nodes as degraded so summaries reflect the fake incident.
                node.status = "DEGRADED"
                node.alarm_text = alarm_text

                noise_alarms.append(Alarm(
                    alarm_id=f"ALM_{alarm_counter:05d}",
                    node_id=node_id,
                    severity=severity,
                    message=alarm_text,
                    layer=node.layer,
                    timestamp=alarm_time,
                    is_noise=True,
                    created_at_s=alarm_time,
                    last_updated_at_s=alarm_time,
                    age_s=0.0,
                    depth_from_root=-1,
                    propagation_delay_s=round(max(0.0, alarm_time - cluster_start_s), 2),
                    escalation_count=0,
                    source="noise",
                ))
                alarm_counter += 1
                used_nodes.add(node_id)

                # Noise clusters keep voltage near nominal so they mimic network symptoms,
                # not hard power faults that can be ruled out instantly.
                if node.layer == "core_switch":
                    node.voltage = round(random.uniform(38.0, 45.5), 1)
                elif node.layer == "radio_controller":
                    node.voltage = round(random.uniform(40.0, 46.0), 1)
                else:
                    node.voltage = round(random.uniform(42.0, 47.5), 1)

        return noise_alarms, alarm_counter

    def _noise_cluster_capacity(
        self,
        nodes: dict[str, NetworkNode],
        anchor_id: str,
        blocked_nodes: set[str],
    ) -> int:
        """Return how many correlated nodes we can assemble around an anchor."""
        return len(self._collect_noise_cluster_nodes(
            nodes=nodes,
            anchor_id=anchor_id,
            blocked_nodes=blocked_nodes,
            cluster_size=6,
        ))

    def _choose_noise_anchor(self, nodes: dict[str, NetworkNode], candidate_ids: list[str]) -> str:
        """Prefer anchors that can spawn convincing multi-node clusters."""
        layer_weights = {
            "core_switch": 5,
            "radio_controller": 4,
            "cell_tower": 2,
        }
        weights = [layer_weights.get(nodes[nid].layer, 1) for nid in candidate_ids]
        return random.choices(candidate_ids, weights=weights, k=1)[0]

    def _collect_noise_cluster_nodes(
        self,
        *,
        nodes: dict[str, NetworkNode],
        anchor_id: str,
        blocked_nodes: set[str],
        cluster_size: int,
    ) -> list[str]:
        """Collect nearby parent/child/sibling nodes for a fake localized incident."""
        if anchor_id in blocked_nodes:
            return []

        ordered_ids: list[str] = []
        seen: set[str] = set()

        def add(node_id: str | None):
            if not node_id or node_id in blocked_nodes or node_id in seen:
                return
            ordered_ids.append(node_id)
            seen.add(node_id)

        anchor = nodes[anchor_id]
        add(anchor_id)

        if anchor.layer == "core_switch":
            children = [cid for cid in anchor.children if cid not in blocked_nodes]
            random.shuffle(children)
            for child_id in children[:2]:
                add(child_id)
                grandchildren = [gid for gid in nodes[child_id].children if gid not in blocked_nodes]
                random.shuffle(grandchildren)
                for grandchild_id in grandchildren[:2]:
                    add(grandchild_id)

        elif anchor.layer == "radio_controller":
            children = [cid for cid in anchor.children if cid not in blocked_nodes]
            random.shuffle(children)
            for child_id in children[:3]:
                add(child_id)

            parent_id = anchor.parent_id
            if parent_id and parent_id not in blocked_nodes:
                siblings = [
                    sid for sid in nodes[parent_id].children
                    if sid not in blocked_nodes and sid != anchor_id
                ]
                random.shuffle(siblings)
                for sibling_id in siblings[:1]:
                    add(sibling_id)

        elif anchor.layer == "cell_tower":
            parent_id = anchor.parent_id
            if parent_id and parent_id not in blocked_nodes:
                add(parent_id)
                siblings = [
                    sid for sid in nodes[parent_id].children
                    if sid not in blocked_nodes and sid != anchor_id
                ]
                random.shuffle(siblings)
                for sibling_id in siblings[:3]:
                    add(sibling_id)

        return ordered_ids[:cluster_size]

    def _sample_cluster_noise_severity(self, layer: str, index_in_cluster: int) -> Severity:
        """Shape clustered noise to resemble a plausible outage cone."""
        if index_in_cluster == 0:
            if layer in ("core_switch", "radio_controller"):
                return random.choice(["MAJOR", "CRITICAL"])
            return random.choice(["WARNING", "MAJOR"])
        if layer == "cell_tower":
            return random.choice(["WARNING", "MAJOR"])
        return random.choice(["MINOR", "WARNING", "MAJOR"])

    def _sample_propagation_delay_s(self, layer: str, depth: int) -> float:
        """Sample alarm propagation delay using layer and BFS depth."""
        layer_base_s = {
            "power_unit": 0.4,
            "core_switch": 0.8,
            "radio_controller": 1.2,
            "cell_tower": 1.8,
        }
        base = layer_base_s.get(layer, 1.0)
        depth_factor = 1.0 + max(depth - 1, 0) * 0.15
        jitter = random.uniform(0.2, 1.8)
        return round(base * depth_factor + jitter, 2)

    def _advance_simulation_clock(self, action_type: str) -> float:
        """Advance deterministic simulation clock based on action latency."""
        s = self._state
        if s is None:
            return 0.0
        delta = self.ACTION_TIME_COST_S.get(action_type, 5.0)
        s.simulation_time_s = round(s.simulation_time_s + delta, 2)
        return delta

    def _next_alarm_id(self) -> str:
        """Return a unique alarm ID for in-episode generated alarms."""
        s = self._state
        if s is None:
            return "ALM_00000"
        alarm_id = f"ALM_{s.alarm_seq:05d}"
        s.alarm_seq += 1
        return alarm_id

    def _next_severity(self, severity: Severity) -> Severity:
        idx = self.SEVERITY_ORDER.index(severity)
        if idx >= len(self.SEVERITY_ORDER) - 1:
            return "CRITICAL"
        return self.SEVERITY_ORDER[idx + 1]

    def _false_positive_penalty(self, weight: float) -> float:
        """Cap false-positive penalties so reward shaping stays bounded."""
        s = self._state
        if s is None:
            return 0.0
        return min(self.MAX_FALSE_POSITIVE_PENALTY, s.false_positives * weight)

    def _escalate_alarm_message(self, message: str, severity: Severity, escalation_count: int) -> str:
        """Replace severity prefix and append escalation metadata."""
        without_tag = message.split(" [ESCALATED")[0]
        if ":" in without_tag:
            _, tail = without_tag.split(":", 1)
            base = tail.strip()
        else:
            base = without_tag.strip()
        return f"{severity}: {base} [ESCALATED x{escalation_count}]"

    def _evolve_alarms(self):
        """
        Evolve active alarms over simulated time:
          - increase alarm age
          - escalate unresolved alarms
          - clear stale transients / resolved alarms
          - spawn occasional new transient alarms
        """
        s = self._state
        if s is None:
            return

        now_s = s.simulation_time_s
        escalation_interval_s = self.ESCALATION_INTERVAL_S.get(self.task_name, 60.0)
        noise_ttl_s = self.NOISE_TTL_S.get(self.task_name, 60.0)
        keep: list[Alarm] = []
        cleared_noise_nodes: set[str] = set()

        for alarm in s.active_alarms:
            node = s.nodes.get(alarm.node_id)
            age_s = round(max(0.0, now_s - alarm.created_at_s), 2)
            alarm.age_s = age_s
            alarm.last_updated_at_s = round(now_s, 2)

            # Clear non-noise alarms once node has recovered.
            if (not alarm.is_noise) and node and node.status == "UP":
                continue

            # Transient alarms self-clear after TTL.
            if alarm.is_noise and age_s >= noise_ttl_s:
                cleared_noise_nodes.add(alarm.node_id)
                continue

            # Escalate unresolved, non-noise alarms with age.
            if (not alarm.is_noise) and alarm.severity != "CRITICAL":
                threshold = (alarm.escalation_count + 1) * escalation_interval_s
                if age_s >= threshold:
                    previous = alarm.severity
                    alarm.severity = self._next_severity(alarm.severity)
                    alarm.escalation_count += 1
                    alarm.escalated_from = previous
                    alarm.last_escalated_at_s = round(now_s, 2)
                    alarm.message = self._escalate_alarm_message(
                        alarm.message,
                        alarm.severity,
                        alarm.escalation_count,
                    )

            keep.append(alarm)

        # Spawn occasional new transient alarms for medium/hard dynamics.
        spawn_prob = self.NOISE_SPAWN_PROB.get(self.task_name, 0.0)
        if self.task_config.noise_ratio > 0 and random.random() < spawn_prob:
            alarming_nodes = {a.node_id for a in keep}
            candidates = [
                nid for nid, node in s.nodes.items()
                if node.layer != "power_unit" and node.status == "UP" and nid not in alarming_nodes
            ]
            if candidates:
                nid = random.choice(candidates)
                node = s.nodes[nid]
                noise_severity: Severity = random.choice(["MINOR", "WARNING"])
                noise_message = self._generate_noise_text(node.layer)
                node.status = "DEGRADED"
                node.alarm_text = noise_message
                keep.append(Alarm(
                    alarm_id=self._next_alarm_id(),
                    node_id=nid,
                    severity=noise_severity,
                    message=noise_message,
                    layer=node.layer,
                    timestamp=round(now_s, 2),
                    is_noise=True,
                    created_at_s=round(now_s, 2),
                    last_updated_at_s=round(now_s, 2),
                    age_s=0.0,
                    depth_from_root=-1,
                    propagation_delay_s=0.0,
                    escalation_count=0,
                    source="evolved_noise",
                ))
                node.voltage = round(random.uniform(42.0, 47.5), 1)

        surviving_alarm_nodes = {alarm.node_id for alarm in keep}
        for node_id in cleared_noise_nodes:
            if node_id in surviving_alarm_nodes:
                continue
            node = s.nodes.get(node_id)
            if node is None or node.status == "FAILED":
                continue
            node.status = "UP"
            node.alarm_text = None
            node.voltage = 48.0

        keep.sort(key=lambda alarm: alarm.created_at_s)
        s.active_alarms = keep

    def _build_graph_observation(self) -> dict:
        """
        Build a compact graph view for graph-native agents and frontend tooling.

        The graph is capped so large hard-mode episodes do not explode payload size.
        """
        s = self._state
        if s is None:
            return {}

        node_ids = sorted(s.nodes.keys())
        max_nodes = 100
        alarming_node_ids = {alarm.node_id for alarm in s.active_alarms}
        def _priority_key(nid):
            node = s.nodes[nid]
            return (0 if node.status == "FAILED" else 1 if nid in alarming_node_ids else 2, nid)
        included_node_ids = sorted(s.nodes.keys(), key=_priority_key)[:max_nodes]
        included_node_set = set(included_node_ids)

        depth_map: dict[str, int] = {}
        queue: deque[str] = deque()
        for node_id, node in s.nodes.items():
            if node.parent_id is None:
                depth_map[node_id] = 0
                queue.append(node_id)

        while queue:
            current_id = queue.popleft()
            current_depth = depth_map[current_id]
            for child_id in s.nodes[current_id].children:
                depth_map[child_id] = current_depth + 1
                queue.append(child_id)

        layer_encoding = {
            "power_unit": 0,
            "core_switch": 1,
            "radio_controller": 2,
            "cell_tower": 3,
        }
        status_encoding = {
            "UP": 0,
            "DEGRADED": 1,
            "FAILED": 2,
        }
        alarming_nodes = {alarm.node_id for alarm in s.active_alarms}
        checked_nodes = set(s.checked_nodes)

        node_index = {node_id: idx for idx, node_id in enumerate(included_node_ids)}
        graph_nodes = []
        for node_id in included_node_ids:
            node = s.nodes[node_id]
            graph_nodes.append({
                "node_id": node_id,
                "index": node_index[node_id],
                "layer": layer_encoding[node.layer],
                "layer_name": node.layer,
                "status": status_encoding[node.status],
                "status_name": node.status,
                "region": node.region,
                "depth": depth_map.get(node_id, 0),
                "degree": len(node.children),
                "voltage_v": node.voltage,
                "temperature_c": node.temperature_c,
                "is_alarm_source": node_id in alarming_nodes,
                "is_checked": node_id in checked_nodes,
                "is_root_candidate": node.status == "FAILED" or (
                    node.status == "DEGRADED" and len(node.children) >= 2
                ),
            })

        graph_edges = []
        for parent_id, child_id in s.topology_edges:
            if parent_id not in included_node_set or child_id not in included_node_set:
                continue
            graph_edges.append({
                "source": node_index[parent_id],
                "target": node_index[child_id],
                "source_id": parent_id,
                "target_id": child_id,
            })

        max_edges = 300
        return {
            "nodes": graph_nodes,
            "edges": graph_edges[:max_edges],
            "node_count_total": len(s.nodes),
            "edge_count_total": len(s.topology_edges),
            "truncated": len(s.nodes) > max_nodes or len(s.topology_edges) > max_edges,
        }

    def _generate_alarm_text(self, layer: str, severity: str) -> str:
        """Generate realistic alarm text for a given layer and severity."""
        templates = {
            "cell_tower": [
                f"{severity}: RF signal loss on sector A. RSRP below -110 dBm. UE disconnections: 342.",
                f"{severity}: Cell tower handover failure rate 78%. KPI breach on inter-frequency HO.",
                f"{severity}: Backhaul link packet loss 23%. SLA violation. Jitter 45ms.",
                f"{severity}: VSWR alarm on antenna port 1. Forward power dropped 6dB.",
                f"{severity}: RRU communication timeout. CPRI link layer2 sync lost.",
            ],
            "radio_controller": [
                f"{severity}: RRC connection setup failures spiked to 340/hr. Capacity impacted.",
                f"{severity}: Baseband unit temperature 91°C. Thermal threshold exceeded.",
                f"{severity}: Timing sync lost. GPS reference unavailable for 120s.",
                f"{severity}: S1 interface to EPC down. All UE context lost. MME unreachable.",
                f"{severity}: PDCP layer errors. Data radio bearer setup failures at 42%.",
            ],
            "core_switch": [
                f"{severity}: BGP session flap. Route withdrawal for 192.168.x.0/24. AS path unstable.",
                f"{severity}: Port Gi0/1 CRC errors: 14,582 in last 5 min. Possible cable/transceiver fault.",
                f"{severity}: OSPF adjacency dropped with peer 10.0.0.x. Area 0 reconverging.",
                f"{severity}: MPLS LSP tunnel down. Traffic shifted to backup path, 340ms RTT increase.",
                f"{severity}: ARP table overflow. MAC flapping on VLAN 100. Loop suspected.",
            ],
            "power_unit": [
                f"{severity}: UPS battery at 12%. Runtime estimate 8 minutes. Load shedding imminent.",
                f"{severity}: Rectifier module 2 offline. Load redistributed to modules 1,3.",
                f"{severity}: AC input phase C missing. Generator transfer pending. Fuel level: 34%.",
                f"{severity}: DC bus voltage fluctuating 44-51V. Ripple exceeds 2% threshold.",
            ],
        }
        return random.choice(templates.get(layer, [f"{severity}: Unknown fault on {layer}."]))

    def _generate_noise_text(self, layer: str) -> str:
        """Generate a plausible but spurious alarm (noise) for a healthy node."""
        noise_templates = {
            "cell_tower": [
                "MINOR: Scheduled RSSI measurement deviation +2dB. Within tolerance.",
                "WARNING: Antenna tilt adjusted by RAN optimiser. Performance nominal.",
                "MINOR: Temporary UE camping spike during event. Self-resolved.",
            ],
            "radio_controller": [
                "MINOR: License usage at 80%. Capacity planning advisory.",
                "WARNING: Software patch pending. Auto-install scheduled 03:00 UTC.",
                "MINOR: Inter-RAT handover success rate dipped to 96%. Monitoring.",
            ],
            "core_switch": [
                "MINOR: NTP clock drift 12ms. Resynchronising with stratum-1 source.",
                "WARNING: SNMP trap: ifOperStatus change on management interface. Auto-recovered.",
                "MINOR: ACL hit count anomaly on rule 47. Logging enabled.",
            ],
            "power_unit": [
                "MINOR: Battery equalisation charge cycle completed normally.",
                "WARNING: Environmental sensor: humidity at 72%. Within operating range.",
            ],
        }
        return random.choice(noise_templates.get(layer, ["MINOR: Transient event. Self-cleared."]))

    # ------------------------------------------------------------------ #
    #  Action handlers                                                     #
    # ------------------------------------------------------------------ #

    def _handle_check(self, node_id: str) -> tuple[float, dict]:
        """CHECK_LOGS: Read error logs for a node."""
        s = self._state
        if node_id not in s.nodes:
            return -0.05, {"error": f"Node {node_id} not found in topology"}
        s.checked_nodes.add(node_id)
        node = s.nodes[node_id]

        # Build a rich log response
        log_data = {
            "node_id": node_id,
            "status": node.status,
            "layer": node.layer,
            "region": node.region,
            "parent": node.parent_id,
            "children_count": len(node.children),
            "log": node.alarm_text or "No anomalies in logs. System operating normally.",
            "uptime_hours": node.uptime_hours,
        }

        # Extra hint if this is the root cause
        if node_id == s.root_cause_id:
            log_data["log"] += " [KERNEL PANIC] System halted. Manual intervention required."

        log_data["reward_breakdown"] = {"analysis_reward": 0.02}
        return 0.02, log_data

    def _handle_voltage(self, node_id: str) -> tuple[float, dict]:
        """CHECK_VOLTAGE: Measure voltage — smoking gun for hardware faults."""
        s = self._state
        if node_id not in s.nodes:
            return -0.05, {"error": f"Node {node_id} not found in topology"}

        node = s.nodes[node_id]
        s.checked_nodes.add(node_id)

        return 0.03, {
            "node_id": node_id,
            "voltage_v": node.voltage,
            "temperature_c": node.temperature_c,
            "status": "NOMINAL" if node.voltage > 44 else (
                "WARNING" if node.voltage > 30 else "CRITICAL"
            ),
            "layer": node.layer,
            "threshold": "48V nominal, <30V = hardware fault",
            "reward_breakdown": {"diagnostic_reward": 0.03},
        }

    def _handle_trace_path(self, node_id: str) -> tuple[float, dict]:
        """TRACE_PATH: Show the full path from this node up to the root of the tree."""
        s = self._state
        if node_id not in s.nodes:
            return -0.05, {"error": f"Node {node_id} not found in topology"}
        s.checked_nodes.add(node_id)

        path = []
        current = node_id
        while current:
            node = s.nodes[current]
            path.append({
                "node_id": current,
                "layer": node.layer,
                "status": node.status,
                "region": node.region,
            })
            current = node.parent_id

        children_info = []
        for child_id in s.nodes[node_id].children:
            child = s.nodes[child_id]
            children_info.append({
                "node_id": child_id,
                "layer": child.layer,
                "status": child.status,
            })

        return 0.02, {
            "node_id": node_id,
            "path_to_root": path,
            "direct_children": children_info,
            "depth": len(path) - 1,
            "path_nodes": [entry["node_id"] for entry in path],
            "reward_breakdown": {
                "path_insight_reward": 0.02,
            },
        }

    def _handle_restart(self, node_id: str) -> tuple[float, dict]:
        """RESTART: Fix the network IF this is the root cause. Heavy FP penalty if not."""
        s = self._state
        if node_id not in s.nodes:
            return -0.05, {"error": f"Node {node_id} not found in topology"}

        node = s.nodes[node_id]
        s.restarted_nodes.add(node_id)

        if node_id == s.root_cause_id:
            # ✅ Correct fix — clear all downstream alarms
            cleared_count = len(s.active_alarms)
            self._clear_downstream(node_id)
            elapsed = round(s.simulation_time_s, 2)
            mttr_bonus = max(0.0, 1.0 - elapsed / 300)  # bonus for speed
            fp_penalty = self._false_positive_penalty(0.15)
            reward = 1.0 + mttr_bonus - fp_penalty
            s.episode_done = True
            return reward, {
                "result": "ROOT_CAUSE_FIXED",
                "root_cause_id": node_id,
                "root_cause_layer": node.layer,
                "mttr_seconds": elapsed,
                "false_positives": s.false_positives,
                "final_reward": round(reward, 4),
                "alarms_cleared": cleared_count,
                "reward_breakdown": {
                    "resolution_reward": 1.0,
                    "mttr_bonus": round(mttr_bonus, 4),
                    "false_positive_penalty": round(-fp_penalty, 4),
                },
            }
        else:
            # ❌ Wrong node restarted — false positive penalty
            s.false_positives += 1
            return -0.3, {
                "result": "FALSE_POSITIVE",
                "restarted": node_id,
                "restarted_layer": node.layer,
                "false_positives_total": s.false_positives,
                "reward_breakdown": {
                    "false_positive_penalty": -0.3,
                },
                "note": (
                    "Node restarted but alarms persist. Network still degraded. "
                    "A field crew was dispatched to the wrong location."
                ),
            }

    def _handle_diagnose(self, node_id: str) -> tuple[float, dict]:
        """DIAGNOSE: Declare root cause without restarting (safer, less reward)."""
        s = self._state
        if node_id not in s.nodes:
            return -0.05, {"error": f"Node {node_id} not found in topology"}
        s.diagnosed_nodes.add(node_id)

        if node_id == s.root_cause_id:
            elapsed = round(s.simulation_time_s, 2)
            mttr_bonus = max(0.0, 1.0 - elapsed / 300)
            fp_penalty = self._false_positive_penalty(0.1)
            reward = 0.8 + mttr_bonus * 0.5 - fp_penalty
            s.episode_done = True
            return reward, {
                "result": "CORRECT_DIAGNOSIS",
                "root_cause_id": node_id,
                "root_cause_layer": s.nodes[node_id].layer,
                "mttr_seconds": elapsed,
                "false_positives": s.false_positives,
                "reward_breakdown": {
                    "resolution_reward": 0.8,
                    "mttr_bonus": round(mttr_bonus * 0.5, 4),
                    "false_positive_penalty": round(-fp_penalty, 4),
                },
                "note": "Correct root cause identified. Maintenance scheduled.",
            }
        else:
            s.false_positives += 1
            return -0.2, {
                "result": "WRONG_DIAGNOSIS",
                "guessed": node_id,
                "guessed_layer": s.nodes.get(node_id, NetworkNode(
                    node_id="?", layer="cell_tower"
                )).layer if node_id in s.nodes else "unknown",
                "false_positives_total": s.false_positives,
                "reward_breakdown": {
                    "false_positive_penalty": -0.2,
                },
            }

    def _clear_downstream(self, node_id: str):
        """Clear all alarms downstream from a fixed node."""
        s = self._state
        queue = deque([node_id])
        while queue:
            nid = queue.popleft()
            s.nodes[nid].status = "UP"
            s.nodes[nid].alarm_text = None
            s.nodes[nid].voltage = 48.0
            queue.extend(s.nodes[nid].children)
        s.active_alarms = []

    def _build_observation(self) -> AgentObservation:
        """Build the agent-facing observation, including a network topology summary."""
        s = self._state
        now_s = s.simulation_time_s

        alarm_ages: list[float] = []
        escalated_alarm_count = 0
        for alarm in s.active_alarms:
            age_s = round(max(0.0, now_s - alarm.created_at_s), 2)
            alarm.age_s = age_s
            alarm.last_updated_at_s = round(now_s, 2)
            alarm_ages.append(age_s)
            if alarm.escalation_count > 0:
                escalated_alarm_count += 1

        alarm_age_summary = {
            "average_age_s": round(sum(alarm_ages) / len(alarm_ages), 2) if alarm_ages else 0.0,
            "oldest_age_s": round(max(alarm_ages), 2) if alarm_ages else 0.0,
            "newest_age_s": round(min(alarm_ages), 2) if alarm_ages else 0.0,
            "escalated_alarm_count": escalated_alarm_count,
        }

        # Build layer summary
        layer_counts: Counter = Counter()
        layer_alarming: Counter = Counter()
        for node in s.nodes.values():
            layer_counts[node.layer] += 1
            if node.status != "UP":
                layer_alarming[node.layer] += 1

        # Build region summary
        region_alarm_counts = {}
        for region, node_ids in s.regions.items():
            alarming = sum(1 for nid in node_ids if s.nodes[nid].status != "UP")
            region_alarm_counts[region] = {
                "total_nodes": len(node_ids),
                "alarming_nodes": alarming,
            }

        network_summary = {
            "total_nodes": len(s.nodes),
            "layers": {
                layer: {"total": layer_counts[layer], "alarming": layer_alarming[layer]}
                for layer in ["power_unit", "core_switch", "radio_controller", "cell_tower"]
                if layer_counts[layer] > 0
            },
            "regions": region_alarm_counts,
        }
        graph = self._build_graph_observation()

        return AgentObservation(
            active_alarms=s.active_alarms[:50],  # cap to avoid token explosion
            total_alarm_count=len(s.active_alarms),
            steps_remaining=s.max_steps - s.steps_taken,
            false_positives_so_far=s.false_positives,
            checked_nodes=list(s.checked_nodes),
            episode_done=s.episode_done,
            task_description=self.task_config.description,
            network_summary=network_summary,
            simulation_time_s=round(now_s, 2),
            alarm_age_summary=alarm_age_summary,
            graph=graph,
        )
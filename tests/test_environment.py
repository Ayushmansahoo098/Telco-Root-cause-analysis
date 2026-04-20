"""
Comprehensive tests for the Telco-RCA environment, graders, and models.

Run:  python -m pytest tests/ -v
"""

import sys
import os
import time

# Ensure the app package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.environment import TelcoRCAEnvironment
from app.models import AgentAction, TASK_CONFIGS, NetworkNode, Alarm
from app.graders import grade_easy, grade_medium, grade_hard, grade_extreme, grade_episode


# ================================================================== #
#  Environment Reset Tests                                             #
# ================================================================== #

class TestEnvironmentReset:

    def test_reset_returns_observation(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        assert obs.total_alarm_count >= 0
        assert obs.steps_remaining == 15
        assert obs.episode_done is False
        assert obs.task_description != ""

    def test_reset_produces_alarms(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        assert obs.total_alarm_count >= 1

    def test_hard_reset(self):
        env = TelcoRCAEnvironment("hard")
        obs = env.reset()
        assert obs.steps_remaining == 50

    def test_extreme_reset(self):
        env = TelcoRCAEnvironment("extreme")
        obs = env.reset(seed=7)
        assert obs.steps_remaining == 75
        assert obs.total_alarm_count >= 1

    def test_medium_reset(self):
        env = TelcoRCAEnvironment("medium")
        obs = env.reset()
        assert obs.steps_remaining == 30
        assert obs.total_alarm_count >= 1

    def test_invalid_task_raises(self):
        try:
            env = TelcoRCAEnvironment("impossible")
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_reset_with_seed_deterministic(self):
        env1 = TelcoRCAEnvironment("easy")
        obs1 = env1.reset(seed=42)
        rc1 = env1._state.root_cause_id

        env2 = TelcoRCAEnvironment("easy")
        obs2 = env2.reset(seed=42)
        rc2 = env2._state.root_cause_id

        assert rc1 == rc2
        assert obs1.total_alarm_count == obs2.total_alarm_count

    def test_network_summary_in_observation(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        assert "total_nodes" in obs.network_summary
        assert "layers" in obs.network_summary
        assert obs.network_summary["total_nodes"] > 0

    def test_graph_features_in_observation(self):
        env = TelcoRCAEnvironment("medium")
        obs = env.reset(seed=5)
        assert "nodes" in obs.graph
        assert "edges" in obs.graph
        assert obs.graph["node_count_total"] == TASK_CONFIGS["medium"].num_nodes
        assert obs.graph["node_count_total"] >= len(obs.graph["nodes"])
        if obs.graph["nodes"]:
            first_node = obs.graph["nodes"][0]
            assert "node_id" in first_node
            assert "layer" in first_node
            assert "status" in first_node

    def test_hard_noise_forms_structural_clusters(self):
        env = TelcoRCAEnvironment("hard")
        env.reset(seed=11)

        noise_nodes = {
            alarm.node_id for alarm in env._state.active_alarms
            if alarm.is_noise
        }

        assert len(noise_nodes) >= 2
        assert any(
            (
                env._state.nodes[node_id].parent_id in noise_nodes
                or any(child_id in noise_nodes for child_id in env._state.nodes[node_id].children)
            )
            for node_id in noise_nodes
        )


# ================================================================== #
#  Topology Tests                                                      #
# ================================================================== #

class TestTopology:

    def test_easy_node_count(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        assert len(env._state.nodes) == TASK_CONFIGS["easy"].num_nodes

    def test_medium_node_count(self):
        env = TelcoRCAEnvironment("medium")
        env.reset()
        assert len(env._state.nodes) == TASK_CONFIGS["medium"].num_nodes

    def test_hard_node_count(self):
        env = TelcoRCAEnvironment("hard")
        env.reset()
        assert len(env._state.nodes) == TASK_CONFIGS["hard"].num_nodes

    def test_extreme_node_count(self):
        env = TelcoRCAEnvironment("extreme")
        env.reset(seed=7)
        assert len(env._state.nodes) == TASK_CONFIGS["extreme"].num_nodes

    def test_parent_child_consistency(self):
        """Every child should point back to its parent."""
        env = TelcoRCAEnvironment("medium")
        env.reset()
        for nid, node in env._state.nodes.items():
            for child_id in node.children:
                child = env._state.nodes[child_id]
                assert child.parent_id == nid, (
                    f"Child {child_id} has parent {child.parent_id}, "
                    f"expected {nid}"
                )

    def test_topology_has_all_layers(self):
        env = TelcoRCAEnvironment("medium")
        env.reset()
        layers = {n.layer for n in env._state.nodes.values()}
        assert "power_unit" in layers
        assert "core_switch" in layers
        assert "radio_controller" in layers
        assert "cell_tower" in layers

    def test_power_units_are_roots(self):
        """Power units should have no parent."""
        env = TelcoRCAEnvironment("easy")
        env.reset()
        for nid, node in env._state.nodes.items():
            if node.layer == "power_unit":
                assert node.parent_id is None

    def test_edges_match_children(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        edge_set = set(env._state.topology_edges)
        for nid, node in env._state.nodes.items():
            for child_id in node.children:
                assert (nid, child_id) in edge_set

    def test_regions_cover_all_nodes(self):
        env = TelcoRCAEnvironment("hard")
        env.reset()
        all_in_regions = set()
        for nodes in env._state.regions.values():
            all_in_regions.update(nodes)
        for nid in env._state.nodes:
            assert nid in all_in_regions, f"Node {nid} not in any region"

    def test_topology_rejects_oversized_graph(self):
        env = TelcoRCAEnvironment("hard")
        try:
            env._build_topology(1501, 2)
            assert False, "Should have raised ValueError"
        except ValueError as exc:
            assert "num_nodes too large" in str(exc)


# ================================================================== #
#  Step Action Tests                                                   #
# ================================================================== #

class TestEnvironmentStep:

    def test_check_logs_action(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        alarm = obs.active_alarms[0] if obs.active_alarms else None
        if alarm:
            action = AgentAction(action_type="CHECK_LOGS", target_node_id=alarm.node_id)
            result = env.step(action)
            assert result.reward > -1.0
            assert "log" in result.info

    def test_check_voltage_action(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        alarm = obs.active_alarms[0] if obs.active_alarms else None
        if alarm:
            action = AgentAction(action_type="CHECK_VOLTAGE", target_node_id=alarm.node_id)
            result = env.step(action)
            assert "voltage_v" in result.info
            assert "temperature_c" in result.info

    def test_trace_path_action(self):
        env = TelcoRCAEnvironment("medium")
        obs = env.reset()
        alarm = obs.active_alarms[0] if obs.active_alarms else None
        if alarm:
            action = AgentAction(action_type="TRACE_PATH", target_node_id=alarm.node_id)
            result = env.step(action)
            assert "path_to_root" in result.info
            assert len(result.info["path_to_root"]) >= 1
            assert "direct_children" in result.info

    def test_invalid_node_penalty(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        action = AgentAction(action_type="CHECK_LOGS", target_node_id="NONEXISTENT_999")
        result = env.step(action)
        assert result.reward < 0

    def test_episode_terminates_on_correct_restart(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        action = AgentAction(action_type="RESTART", target_node_id=root)
        result = env.step(action)
        assert result.done is True
        assert result.reward > 0.5
        assert result.info["result"] == "ROOT_CAUSE_FIXED"

    def test_false_positive_on_wrong_restart(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        wrong = next(nid for nid in env._state.nodes if nid != root)
        action = AgentAction(action_type="RESTART", target_node_id=wrong)
        result = env.step(action)
        assert result.reward < 0
        assert result.observation.false_positives_so_far == 1
        assert result.info["result"] == "FALSE_POSITIVE"

    def test_correct_diagnose(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        action = AgentAction(action_type="DIAGNOSE", target_node_id=root)
        result = env.step(action)
        assert result.done is True
        assert result.reward > 0
        assert result.info["result"] == "CORRECT_DIAGNOSIS"

    def test_wrong_diagnose(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        wrong = next(nid for nid in env._state.nodes if nid != root)
        action = AgentAction(action_type="DIAGNOSE", target_node_id=wrong)
        result = env.step(action)
        assert result.reward < 0
        assert result.info["result"] == "WRONG_DIAGNOSIS"

    def test_step_before_reset_raises(self):
        env = TelcoRCAEnvironment("easy")
        try:
            action = AgentAction(action_type="CHECK_LOGS", target_node_id="PWR_000")
            env.step(action)
            assert False, "Should have raised RuntimeError"
        except RuntimeError:
            pass

    def test_step_after_done_raises(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        action = AgentAction(action_type="RESTART", target_node_id=root)
        env.step(action)  # ends episode
        try:
            env.step(action)
            assert False, "Should have raised RuntimeError"
        except RuntimeError:
            pass

    def test_max_steps_terminates(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        wrong = next(nid for nid in env._state.nodes if nid != root)
        for _ in range(15):
            action = AgentAction(action_type="CHECK_LOGS", target_node_id=wrong)
            result = env.step(action)
            if result.done:
                break
        assert result.done is True

    def test_voltage_root_cause_is_critical(self):
        """Root cause should have very low voltage."""
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        action = AgentAction(action_type="CHECK_VOLTAGE", target_node_id=root)
        result = env.step(action)
        assert result.info["voltage_v"] < 30
        assert result.info["status"] == "CRITICAL"

    def test_false_positive_penalty_caps_in_live_reward(self):
        env = TelcoRCAEnvironment("hard")
        env.reset(seed=9)
        root = env._state.root_cause_id
        wrong_nodes = [nid for nid in env._state.nodes if nid != root][:12]

        for wrong in wrong_nodes:
            result = env.step(AgentAction(action_type="DIAGNOSE", target_node_id=wrong))
            assert result.done is False

        final = env.step(AgentAction(action_type="RESTART", target_node_id=root))
        expected = round(1.0 + max(0.0, 1.0 - final.info["mttr_seconds"] / 300.0) - 0.8, 4)
        assert final.reward == expected
        assert final.info["final_reward"] == expected


# ================================================================== #
#  Grader Tests                                                        #
# ================================================================== #

class TestGraders:

    def test_score_range(self):
        for grade_fn in [grade_easy, grade_medium, grade_hard, grade_extreme]:
            score = grade_fn({
                "root_cause_fixed": True,
                "steps_taken": 5,
                "false_positives": 0,
                "elapsed_seconds": 10,
            })
            assert 0.0 < score < 1.0, f"Score out of range: {score}"

    def test_zero_score_on_failure(self):
        score = grade_easy({
            "root_cause_fixed": False,
            "correct_diagnosis": False,
            "steps_taken": 15,
            "false_positives": 3,
            "elapsed_seconds": 300,
        })
        assert 0.0 < score < 0.01

    def test_better_score_fewer_steps(self):
        fast = grade_medium({
            "root_cause_fixed": True,
            "steps_taken": 3,
            "false_positives": 0,
            "elapsed_seconds": 5,
        })
        slow = grade_medium({
            "root_cause_fixed": True,
            "steps_taken": 28,
            "false_positives": 0,
            "elapsed_seconds": 280,
        })
        assert fast > slow

    def test_fp_penalty_reduces_score(self):
        clean = grade_hard({
            "root_cause_fixed": True,
            "steps_taken": 10,
            "false_positives": 0,
            "elapsed_seconds": 30,
        })
        dirty = grade_hard({
            "root_cause_fixed": True,
            "steps_taken": 10,
            "false_positives": 3,
            "elapsed_seconds": 30,
        })
        assert clean > dirty

    def test_grade_episode_breakdown(self):
        result = grade_episode(
            task_name="easy",
            root_cause_fixed=True,
            steps_taken=5,
            false_positives=0,
            elapsed_seconds=15,
        )
        assert "score" in result
        assert "breakdown" in result
        assert result["score"] > 0
        assert "f1_score" in result["breakdown"]
        assert "precision" in result["breakdown"]
        assert "recall" in result["breakdown"]

    def test_deterministic(self):
        kwargs = dict(
            task_name="medium",
            root_cause_fixed=True,
            steps_taken=10,
            false_positives=1,
            elapsed_seconds=45,
        )
        assert grade_episode(**kwargs)["score"] == grade_episode(**kwargs)["score"]

    def test_perfect_score(self):
        """Fastest possible solve should give high score."""
        score = grade_easy({
            "root_cause_fixed": True,
            "steps_taken": 1,
            "false_positives": 0,
            "elapsed_seconds": 0.5,
        })
        assert score > 0.9

    def test_diagnosis_also_scores(self):
        """Correct diagnosis without restart should still score."""
        score = grade_medium({
            "root_cause_fixed": False,
            "correct_diagnosis": True,
            "steps_taken": 5,
            "false_positives": 0,
            "elapsed_seconds": 10,
        })
        assert score > 0.5

    def test_many_fps_cap_penalty(self):
        """FP penalty should cap at 0.8 even with many false positives."""
        result = grade_episode(
            task_name="hard",
            root_cause_fixed=True,
            steps_taken=10,
            false_positives=20,  # tons of FPs
            elapsed_seconds=30,
        )
        assert result["breakdown"]["fp_penalty"] == 0.8


# ================================================================== #
#  State Endpoint Tests                                                #
# ================================================================== #

class TestStateEndpoint:

    def test_state_before_reset(self):
        env = TelcoRCAEnvironment("easy")
        state = env.state()
        assert state["status"] == "not_started"

    def test_state_after_reset(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        state = env.state()
        assert state["steps_taken"] == 0
        assert state["root_cause_fixed"] is False
        assert state["correct_diagnosis"] is False
        assert "total_nodes" in state
        assert "regions" in state
        assert "root_cause_id" not in state
        assert "root_cause_layer" not in state

    def test_internal_state_can_include_answer_key(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        state = env.state(include_answer_key=True)
        assert "root_cause_id" in state
        assert "root_cause_layer" in state

    def test_state_tracks_steps(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        alarm = obs.active_alarms[0]
        action = AgentAction(action_type="CHECK_LOGS", target_node_id=alarm.node_id)
        env.step(action)
        state = env.state()
        assert state["steps_taken"] == 1

    def test_state_tracks_checked_nodes(self):
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        alarm = obs.active_alarms[0]
        action = AgentAction(action_type="CHECK_LOGS", target_node_id=alarm.node_id)
        env.step(action)
        state = env.state()
        assert alarm.node_id in state["checked_nodes"]

    def test_state_tracks_resolution_without_leaking_answer_key(self):
        env = TelcoRCAEnvironment("easy")
        env.reset()
        root = env._state.root_cause_id
        env.step(AgentAction(action_type="RESTART", target_node_id=root))
        state = env.state()
        assert state["root_cause_fixed"] is True
        assert state["resolved_node_id"] == root
        assert "root_cause_id" not in state


# ================================================================== #
#  Trajectory Tests                                                    #
# ================================================================== #

class TestTrajectoryEndpoint:

    def test_trajectory_before_reset(self):
        env = TelcoRCAEnvironment("easy")
        trajectory = env.trajectory()
        assert trajectory["status"] == "not_started"

    def test_trajectory_captures_steps_and_heatmap(self):
        env = TelcoRCAEnvironment("medium")
        obs = env.reset(seed=13)
        alarm = obs.active_alarms[0]

        env.step(AgentAction(action_type="CHECK_LOGS", target_node_id=alarm.node_id))
        env.step(AgentAction(action_type="TRACE_PATH", target_node_id=alarm.node_id))

        trajectory = env.trajectory()

        assert trajectory["step_log"]
        assert trajectory["reward_series"]
        assert trajectory["heatmap"]
        assert alarm.node_id in trajectory["path_nodes"]
        assert trajectory["step_log"][0]["reward_breakdown"]
        assert trajectory["path_segments"]


# ================================================================== #
#  Model Validation Tests                                              #
# ================================================================== #

class TestModels:

    def test_task_configs_exist(self):
        assert "easy" in TASK_CONFIGS
        assert "medium" in TASK_CONFIGS
        assert "hard" in TASK_CONFIGS
        assert "extreme" in TASK_CONFIGS

    def test_task_config_fields(self):
        for name, cfg in TASK_CONFIGS.items():
            assert cfg.num_nodes > 0
            assert cfg.max_steps > 0
            assert len(cfg.failure_layers) > 0
            assert 0.0 <= cfg.noise_ratio <= 1.0

    def test_agent_action_validation(self):
        # Valid action
        action = AgentAction(action_type="CHECK_LOGS", target_node_id="PWR_000")
        assert action.action_type == "CHECK_LOGS"

        # Valid TRACE_PATH action
        action = AgentAction(action_type="TRACE_PATH", target_node_id="SW_00_01")
        assert action.action_type == "TRACE_PATH"

    def test_alarm_model(self):
        alarm = Alarm(
            alarm_id="ALM_00001",
            node_id="PWR_001",
            severity="CRITICAL",
            message="Test alarm",
            layer="power_unit",
            timestamp=time.time(),
        )
        assert alarm.severity == "CRITICAL"
        assert alarm.is_noise is False


# ================================================================== #
#  Integration Tests                                                   #
# ================================================================== #

class TestIntegration:

    def test_full_easy_episode(self):
        """Run a complete easy episode using oracle strategy."""
        env = TelcoRCAEnvironment("easy")
        obs = env.reset()
        root = env._state.root_cause_id

        # Step 1: Check voltage of root cause
        result = env.step(AgentAction(
            action_type="CHECK_VOLTAGE", target_node_id=root
        ))
        assert result.info["status"] == "CRITICAL"

        # Step 2: Restart root cause
        result = env.step(AgentAction(
            action_type="RESTART", target_node_id=root
        ))
        assert result.done is True
        assert result.info["result"] == "ROOT_CAUSE_FIXED"

    def test_full_medium_episode_with_investigation(self):
        """Simulate a medium episode with some exploration."""
        env = TelcoRCAEnvironment("medium")
        obs = env.reset()
        root = env._state.root_cause_id

        # Check a few alarm nodes first
        checked = 0
        for alarm in obs.active_alarms[:3]:
            result = env.step(AgentAction(
                action_type="CHECK_LOGS", target_node_id=alarm.node_id
            ))
            checked += 1

        # Trace path from an alarm to find the root
        if obs.active_alarms:
            result = env.step(AgentAction(
                action_type="TRACE_PATH", target_node_id=obs.active_alarms[0].node_id
            ))

        # Now diagnose the real root cause
        result = env.step(AgentAction(
            action_type="DIAGNOSE", target_node_id=root
        ))
        assert result.done is True

    def test_hard_episode_generates_many_alarms(self):
        """Hard task should generate substantial alarm volume."""
        env = TelcoRCAEnvironment("hard")
        obs = env.reset()
        assert obs.total_alarm_count >= 10  # should be many more typically
        assert len(obs.network_summary["regions"]) >= 3

    def test_extreme_episode_scales_with_high_noise(self):
        env = TelcoRCAEnvironment("extreme")
        obs = env.reset(seed=13)
        assert len(obs.graph["nodes"]) <= 100
        assert obs.total_alarm_count >= 20
        assert len(obs.network_summary["regions"]) == TASK_CONFIGS["extreme"].num_regions
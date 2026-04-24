import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chooseAgentAction, buildTranscriptStep, createAgentMemory, createTranscript } from "@/utils/agent";
import { buildFlowElements } from "@/utils/graph";
import { deriveExplainability } from "@/utils/explainability";
import { getState, getTasks, getTrajectory, gradeSimulation, resetSimulation, stepSimulation, stepAgentLLM } from "@/services/api";
import { createStateSocket } from "@/services/socket";

function buildTrajectory(state = {}) {
  return {
    root_cause_fixed: Boolean(state.root_cause_fixed),
    correct_diagnosis: Boolean(state.correct_diagnosis),
    steps_taken: state.steps_taken ?? 0,
    false_positives: state.false_positives ?? 0,
    elapsed_seconds: state.simulation_time_s ?? state.elapsed_seconds ?? 0,
    checked_nodes: state.checked_nodes ?? [],
    checked_layers: state.checked_layers ?? [],
    total_nodes: state.total_nodes ?? 0,
    total_layers_alarming: state.total_layers_alarming ?? 0,
    action_log: state.action_log ?? [],
  };
}

function buildProjectedMetrics({ state, grade, explainability }) {
  const liveConfidence = explainability?.confidence ?? 0;
  const falsePositivePenalty = Math.min((state?.false_positives ?? 0) * 0.12, 0.5);
  const checkedLayerCount = new Set(state?.checked_layers ?? []).size;
  const alarmingLayers = Math.max(state?.total_layers_alarming ?? 1, 1);

  const actualPrecision = grade?.breakdown?.precision ?? 0;
  const actualRecall = grade?.breakdown?.recall ?? 0;
  const actualF1 = grade?.breakdown?.f1_score ?? 0;

  const precision =
    grade !== null
      ? actualPrecision
      : Math.max(0.08, Math.min(0.98, liveConfidence - falsePositivePenalty + 0.15));
  const recall =
    grade !== null
      ? actualRecall
      : Math.max(
          0.06,
          Math.min(0.98, checkedLayerCount / alarmingLayers * 0.72 + liveConfidence * 0.28),
        );
  const f1 =
    grade !== null
      ? actualF1
      : precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

  return {
    f1,
    precision,
    recall,
    score: grade?.score ?? 0,
    mttr: state?.steps_taken ?? 0,
  };
}

function createMetricPoint({ state, grade, explainability }) {
  const projected = buildProjectedMetrics({ state, grade, explainability });
  return {
    step: state?.steps_taken ?? 0,
    f1: Number(projected.f1.toFixed(3)),
    precision: Number(projected.precision.toFixed(3)),
    recall: Number(projected.recall.toFixed(3)),
    score: Number(projected.score.toFixed(3)),
    mttr: projected.mttr,
  };
}

export function useSimulation() {
  const [task, setTask] = useState("medium");
  const [tasks, setTasks] = useState([]);
  const [observation, setObservation] = useState(null);
  const [runtimeState, setRuntimeState] = useState(null);
  const [grade, setGrade] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [transcript, setTranscript] = useState(() => createTranscript("medium"));
  const [latestAction, setLatestAction] = useState(null);
  const [latestInfo, setLatestInfo] = useState(null);
  const [showNoise, setShowNoise] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [error, setError] = useState("");
  const [socketStatus, setSocketStatus] = useState("standby");
  const [agentMemory, setAgentMemory] = useState(() => createAgentMemory());

  const snapshotRef = useRef({});
  const runLoopRef = useRef(false);

  const explainability = useMemo(
    () =>
      deriveExplainability({
        observation,
        selectedNodeId,
        includeNoise: showNoise,
      }),
    [observation, selectedNodeId, showNoise],
  );

  const filteredAlarms = useMemo(
    () => (observation?.active_alarms ?? []).filter((alarm) => showNoise || !alarm.is_noise),
    [observation, showNoise],
  );

  const flow = useMemo(
    () =>
      buildFlowElements({
        graph: observation?.graph,
        activeAlarms: filteredAlarms,
        explainability,
        selectedNodeId,
        state: runtimeState,
        trajectory,
      }),
    [observation?.graph, filteredAlarms, explainability, selectedNodeId, runtimeState, trajectory],
  );

  useEffect(() => {
    snapshotRef.current = {
      task,
      observation,
      runtimeState,
      explainability,
      trajectory,
      selectedNodeId,
      agentMemory,
      showNoise,
    };
  }, [task, observation, runtimeState, explainability, trajectory, selectedNodeId, agentMemory, showNoise]);

  const fetchGrade = useCallback(async (nextTask, nextState) => {
    try {
      return await gradeSimulation({
        task: nextTask,
        trajectory: buildTrajectory(nextState),
      });
    } catch {
      return null;
    }
  }, []);

  const syncState = useCallback(
    async ({ nextTask, nextObservation, resetMetrics = false }) => {
      const nextState = await getState(nextTask);
      const nextExplainability = deriveExplainability({
        observation: nextObservation,
        includeNoise: snapshotRef.current.showNoise ?? true,
      });
      const [nextTrajectory, nextGrade] = await Promise.all([
        getTrajectory(nextTask).catch(() => null),
        fetchGrade(nextTask, nextState),
      ]);
      const nextNodeIds = new Set((nextObservation?.graph?.nodes ?? []).map((node) => node.node_id));
      const preferredNode =
        snapshotRef.current.selectedNodeId && nextNodeIds.has(snapshotRef.current.selectedNodeId)
          ? snapshotRef.current.selectedNodeId
          : nextExplainability.primaryCandidate?.nodeId ??
            nextObservation?.active_alarms?.[0]?.node_id ??
            nextObservation?.graph?.nodes?.[0]?.node_id ??
            null;

      startTransition(() => {
        setObservation(nextObservation);
        setRuntimeState(nextState);
        setGrade(nextGrade);
        setTrajectory(nextTrajectory);
        setSelectedNodeId(preferredNode);
        setMetricsHistory((previous) => {
          const point = createMetricPoint({
            state: nextState,
            grade: nextGrade,
            explainability: nextExplainability,
          });
          return resetMetrics ? [point] : [...previous, point].slice(-18);
        });
      });

      return {
        state: nextState,
        grade: nextGrade,
        explainability: nextExplainability,
      };
    },
    [fetchGrade],
  );

  const loadTasks = useCallback(async () => {
    try {
      const response = await getTasks();
      setTasks(response.tasks ?? []);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const socket = createStateSocket({
      onConnect: () => setSocketStatus("live"),
      onDisconnect: () => setSocketStatus("standby"),
      onState: (payload) => {
        if (!payload?.task || payload.task !== snapshotRef.current.task) {
          return;
        }
        setRuntimeState((current) => ({ ...current, ...payload.state }));
      },
    });

    if (socket.enabled) {
      socket.connect();
      return () => socket.disconnect();
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (!observation) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      if (runLoopRef.current) {
        return;
      }

      try {
        const nextState = await getState(snapshotRef.current.task);
        setRuntimeState(nextState);
      } catch {
        setSocketStatus("polling");
      }
    }, 6000);

    return () => window.clearInterval(intervalId);
  }, [observation]);

  const stopAgent = useCallback(() => {
    runLoopRef.current = false;
    setIsRunningAgent(false);
  }, []);

  const resetCurrentSimulation = useCallback(
    async (nextTask = task) => {
      stopAgent();
      setIsLoading(true);
      setError("");
      setTask(nextTask);
      setObservation(null);
      setRuntimeState(null);
      setGrade(null);
      setTrajectory(null);
      setSelectedNodeId(null);
      setMetricsHistory([]);
      setLatestAction(null);
      setLatestInfo(null);
      setAgentMemory(createAgentMemory());
      setTranscript(createTranscript(nextTask));
      snapshotRef.current = {
        ...snapshotRef.current,
        task: nextTask,
        observation: null,
        runtimeState: null,
        explainability: null,
        trajectory: null,
        selectedNodeId: null,
        agentMemory: createAgentMemory(),
      };

      try {
        const nextObservation = await resetSimulation({
          task: nextTask,
          seed: Date.now(),
        });
        await syncState({
          nextTask,
          nextObservation,
          resetMetrics: true,
        });
      } catch (caughtError) {
        setError(caughtError?.response?.data?.detail ?? caughtError.message ?? "Unable to reset simulation.");
      } finally {
        setIsLoading(false);
      }
    },
    [stopAgent, syncState, task],
  );

  const executeAction = useCallback(
    async ({ actionType, targetNodeId, source = "manual" }) => {
      const activeTask = snapshotRef.current.task;
      const resolvedNodeId = targetNodeId ?? snapshotRef.current.selectedNodeId;
      if (!activeTask || !resolvedNodeId) {
        return false;
      }

      setError("");
      setLatestAction({
        actionType,
        targetNodeId: resolvedNodeId,
        source,
      });

      try {
        const result = await stepSimulation({
          task: activeTask,
          action: {
            action_type: actionType,
            target_node_id: resolvedNodeId,
          },
        });

        setLatestInfo(result.info);
        setAgentMemory((previous) => {
          const next = {
            checkedLogs: new Set(previous.checkedLogs),
            checkedVoltage: new Set(previous.checkedVoltage),
            tracedPaths: new Set(previous.tracedPaths),
            submittedRootCause: previous.submittedRootCause,
          };

          if (actionType === "CHECK_LOGS") {
            next.checkedLogs.add(resolvedNodeId);
          }
          if (actionType === "CHECK_VOLTAGE") {
            next.checkedVoltage.add(resolvedNodeId);
          }
          if (actionType === "TRACE_PATH") {
            next.tracedPaths.add(resolvedNodeId);
          }
          if (actionType === "DIAGNOSE") {
            next.submittedRootCause = true;
          }

          return next;
        });

        const synced = await syncState({
          nextTask: activeTask,
          nextObservation: result.observation,
        });

        setTranscript((previous) => {
          const next = {
            ...previous,
            steps: [...previous.steps, buildTranscriptStep(actionType, resolvedNodeId, result.info)],
          };

          if (result.done) {
            next.final = {
              score: synced.grade?.score ?? 0,
              mttrSteps: synced.state?.steps_taken ?? 0,
            };
          }

          return next;
        });

        return true;
      } catch (caughtError) {
        setError(caughtError?.response?.data?.detail ?? caughtError.message ?? "Unable to execute action.");
        stopAgent();
        return false;
      }
    },
    [stopAgent, syncState],
  );

  const stepAgent = useCallback(async () => {
    if (!snapshotRef.current.observation || snapshotRef.current.runtimeState?.episode_done) {
      return false;
    }

    let nextAction = null;
    try {
      const history = (snapshotRef.current.transcript?.steps || []).map((step, idx) => {
         const match = step.action.match(/([a-zA-Z_]+)\(id=(.*)\)/) || step.action.match(/([A-Z_]+)\((.*)\)/);
         return {
           step: idx + 1,
           action_type: match ? match[1] : step.action,
           target_node_id: match ? match[2] : "",
           info: { status: step.result || "UNKNOWN" }
         };
      });

      const llmResponse = await stepAgentLLM({
        task: snapshotRef.current.task,
        history: history
      });

      if (llmResponse && llmResponse.action_type && llmResponse.target_node_id) {
         nextAction = {
           actionType: llmResponse.action_type.toUpperCase(),
           targetNodeId: llmResponse.target_node_id
         };
      }
    } catch (e) {
      console.error("LLM Agent failed, falling back to heuristic:", e);
    }

    if (!nextAction) {
      nextAction = chooseAgentAction({
        observation: snapshotRef.current.observation,
        explainability: snapshotRef.current.explainability,
        memory: snapshotRef.current.agentMemory,
      });
    }

    if (!nextAction) {
      return false;
    }

    return executeAction({
      ...nextAction,
      source: "agent",
    });
  }, [executeAction]);

  const runAgent = useCallback(async () => {
    if (runLoopRef.current) {
      return;
    }

    runLoopRef.current = true;
    setIsRunningAgent(true);

    while (runLoopRef.current) {
      if (!snapshotRef.current.observation || snapshotRef.current.runtimeState?.episode_done) {
        break;
      }

      const success = await stepAgent();
      if (!success) {
        break;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 900);
      });
    }

    runLoopRef.current = false;
    setIsRunningAgent(false);
  }, [stepAgent]);

  return {
    task,
    tasks,
    observation,
    runtimeState,
    grade,
    trajectory,
    selectedNodeId,
    setSelectedNodeId,
    filteredAlarms,
    explainability,
    flow,
    metricsHistory,
    transcript,
    latestAction,
    latestInfo,
    showNoise,
    setShowNoise,
    isLoading,
    isRunningAgent,
    error,
    socketStatus,
    resetCurrentSimulation,
    executeAction,
    stepAgent,
    runAgent,
    stopAgent,
    setTask,
  };
}

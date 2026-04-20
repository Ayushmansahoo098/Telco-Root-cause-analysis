import { formatActionCall, formatActionResult } from "@/utils/formatters";

function findMostSevereAlarm(observation) {
  return [...(observation?.active_alarms ?? [])].sort((left, right) => {
    const severityOrder = ["MINOR", "WARNING", "MAJOR", "CRITICAL"];
    const severityDelta = severityOrder.indexOf(right.severity) - severityOrder.indexOf(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return (right.depth_from_root ?? 0) - (left.depth_from_root ?? 0);
  })[0];
}

export function createAgentMemory() {
  return {
    checkedLogs: new Set(),
    checkedVoltage: new Set(),
    tracedPaths: new Set(),
    submittedRootCause: false,
  };
}

export function createTranscript(task) {
  return {
    task,
    steps: [],
    final: null,
  };
}

function chooseFallbackNode(observation) {
  return observation?.graph?.nodes?.find((node) => node.is_alarm_source)?.node_id ?? observation?.graph?.nodes?.[0]?.node_id;
}

// A lightweight heuristic policy gives the UI a believable agent loop for demos.
export function chooseAgentAction({ observation, explainability, memory }) {
  if (!observation?.graph?.nodes?.length) {
    return null;
  }

  const primaryNodeId = explainability?.primaryCandidate?.nodeId ?? chooseFallbackNode(observation);
  const seedAlarm = findMostSevereAlarm(observation);

  if (seedAlarm && !memory.tracedPaths.has(seedAlarm.node_id)) {
    return {
      actionType: "TRACE_PATH",
      targetNodeId: seedAlarm.node_id,
    };
  }

  if (primaryNodeId && !memory.checkedLogs.has(primaryNodeId)) {
    return {
      actionType: "CHECK_LOGS",
      targetNodeId: primaryNodeId,
    };
  }

  if (primaryNodeId && !memory.checkedVoltage.has(primaryNodeId)) {
    return {
      actionType: "CHECK_VOLTAGE",
      targetNodeId: primaryNodeId,
    };
  }

  if (primaryNodeId && !memory.submittedRootCause && (explainability?.confidence ?? 0) >= 0.68) {
    return {
      actionType: "DIAGNOSE",
      targetNodeId: primaryNodeId,
    };
  }

  const alternateCandidate = explainability?.candidates?.find(
    (candidate) => !memory.checkedLogs.has(candidate.nodeId),
  );
  if (alternateCandidate) {
    return {
      actionType: "CHECK_LOGS",
      targetNodeId: alternateCandidate.nodeId,
    };
  }

  if (primaryNodeId) {
    return {
      actionType: "DIAGNOSE",
      targetNodeId: primaryNodeId,
    };
  }

  return null;
}

export function buildTranscriptStep(actionType, targetNodeId, info) {
  return {
    action: formatActionCall(actionType, targetNodeId),
    result: formatActionResult(actionType, info),
  };
}


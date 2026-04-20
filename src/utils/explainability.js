import { LAYER_CONFIG, SEVERITY_WEIGHT } from "@/utils/constants";
import { formatLayerLabel, formatRegion } from "@/utils/formatters";

function buildTopology(graph = {}) {
  const nodeMap = new Map((graph.nodes ?? []).map((node) => [node.node_id, node]));
  const parentMap = new Map();
  const childMap = new Map();

  for (const edge of graph.edges ?? []) {
    parentMap.set(edge.target_id, edge.source_id);

    if (!childMap.has(edge.source_id)) {
      childMap.set(edge.source_id, []);
    }
    childMap.get(edge.source_id).push(edge.target_id);
  }

  return { nodeMap, parentMap, childMap };
}

function collectPropagationPath(alarmNodeId, parentMap) {
  const path = [];
  let currentId = alarmNodeId;

  while (currentId) {
    path.push(currentId);
    currentId = parentMap.get(currentId);
  }

  return path;
}

function buildReasons(node, score, descendantAlarmCount, voltageSignal) {
  const reasons = [];

  if (descendantAlarmCount > 0) {
    reasons.push(`${descendantAlarmCount} alarm paths converge here.`);
  }

  if (node?.status_name === "FAILED") {
    reasons.push("Node is already marked failed in the network graph.");
  } else if (node?.status_name === "DEGRADED") {
    reasons.push("Node is degraded while its downstream path is alarming.");
  }

  if (voltageSignal) {
    reasons.push(`Voltage anomaly detected at ${node?.voltage_v?.toFixed?.(1) ?? node?.voltage_v}V.`);
  }

  if (node?.is_checked) {
    reasons.push("This node has supporting diagnostic evidence.");
  }

  reasons.push(`Suspicion score ${score.toFixed(2)} based on topology and alarm density.`);
  return reasons;
}

export function deriveExplainability({ observation, selectedNodeId, includeNoise = true }) {
  if (!observation?.graph?.nodes?.length) {
    return {
      confidence: 0,
      primaryCandidate: null,
      candidates: [],
      reasoning: [],
      propagationPath: [],
      impactedRegions: [],
      selectedNode: null,
    };
  }

  const activeAlarms = (observation.active_alarms ?? []).filter((alarm) => includeNoise || !alarm.is_noise);
  const { nodeMap, parentMap } = buildTopology(observation.graph);
  const scoreMap = new Map();
  const alarmSupportMap = new Map();

  for (const alarm of activeAlarms) {
    const severityWeight = SEVERITY_WEIGHT[alarm.severity] ?? 0.4;
    const noiseFactor = alarm.is_noise ? 0.4 : 1;
    const path = collectPropagationPath(alarm.node_id, parentMap);

    path.forEach((nodeId, index) => {
      const node = nodeMap.get(nodeId);
      if (!node) {
        return;
      }

      const layerBias =
        node.layer_name === "power_unit"
          ? 1.24
          : node.layer_name === "core_switch"
            ? 1.08
            : 1;
      const propagationWeight = index === 0 ? 0.68 : 1.18 / (index + 0.72);
      const degreeBonus = Math.min(node.degree ?? 0, 5) * 0.05;
      const voltageBonus = node.voltage_v < 30 ? 1.1 : node.voltage_v < 40 ? 0.45 : 0;
      const stateBonus = node.status_name === "FAILED" ? 1.25 : node.status_name === "DEGRADED" ? 0.2 : 0;
      const checkedBonus = node.is_checked ? 0.18 : 0;
      const value =
        severityWeight * noiseFactor * propagationWeight * layerBias +
        degreeBonus +
        voltageBonus +
        stateBonus +
        checkedBonus;

      scoreMap.set(nodeId, (scoreMap.get(nodeId) ?? 0) + value);
      alarmSupportMap.set(nodeId, (alarmSupportMap.get(nodeId) ?? 0) + 1);
    });
  }

  const sortedCandidates = [...scoreMap.entries()]
    .map(([nodeId, score]) => {
      const node = nodeMap.get(nodeId);
      const maxScore = Math.max(...scoreMap.values(), 1);
      const confidence = Math.min(0.99, score / maxScore);

      return {
        nodeId,
        node,
        score,
        confidence,
        descendantAlarmCount: alarmSupportMap.get(nodeId) ?? 0,
        voltageSignal: (node?.voltage_v ?? 48) < 40,
        label: LAYER_CONFIG[node?.layer_name]?.label ?? formatLayerLabel(node?.layer_name),
        region: formatRegion(node?.region),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((candidate) => ({
      ...candidate,
      reasons: buildReasons(
        candidate.node,
        candidate.score,
        candidate.descendantAlarmCount,
        candidate.voltageSignal,
      ),
    }));

  const primaryCandidate = sortedCandidates[0] ?? null;
  const seedAlarm = [...activeAlarms]
    .sort((left, right) => {
      const bySeverity = (SEVERITY_WEIGHT[right.severity] ?? 0) - (SEVERITY_WEIGHT[left.severity] ?? 0);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return (right.depth_from_root ?? 0) - (left.depth_from_root ?? 0);
    })[0];

  const propagationPath = seedAlarm ? collectPropagationPath(seedAlarm.node_id, parentMap) : [];
  const impactedRegions = [
    ...new Set(
      activeAlarms
        .map((alarm) => nodeMap.get(alarm.node_id)?.region)
        .filter(Boolean)
        .map((region) => formatRegion(region)),
    ),
  ];

  const reasoning = primaryCandidate
    ? [
        `${primaryCandidate.label} ${primaryCandidate.nodeId} has the highest upstream convergence score.`,
        `${activeAlarms.length} active alarms collapse into ${Math.max(primaryCandidate.descendantAlarmCount, 1)} corroborating paths.`,
        primaryCandidate.voltageSignal
          ? "Voltage readings are consistent with a physical hardware fault."
          : "Topology pressure is stronger than local noise around this node.",
      ]
    : [];

  return {
    confidence: primaryCandidate?.confidence ?? 0,
    primaryCandidate,
    candidates: sortedCandidates,
    reasoning,
    propagationPath,
    impactedRegions,
    selectedNode: selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null,
  };
}


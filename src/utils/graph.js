import { LAYER_CONFIG } from "@/utils/constants";

function createPositions(nodes = []) {
  const groupedByDepth = new Map();
  const regions = [...new Set(nodes.map((node) => node.region))].sort();

  for (const node of nodes) {
    if (!groupedByDepth.has(node.depth)) {
      groupedByDepth.set(node.depth, []);
    }
    groupedByDepth.get(node.depth).push(node);
  }

  const positions = new Map();

  [...groupedByDepth.entries()]
    .sort((left, right) => left[0] - right[0])
    .forEach(([depth, depthNodes]) => {
      const ordered = [...depthNodes].sort((left, right) => {
        const regionDelta = regions.indexOf(left.region) - regions.indexOf(right.region);
        if (regionDelta !== 0) {
          return regionDelta;
        }
        return left.node_id.localeCompare(right.node_id);
      });

      const laneHeights = new Map();
      ordered.forEach((node) => {
        const regionIndex = Math.max(regions.indexOf(node.region), 0);
        const laneCount = laneHeights.get(regionIndex) ?? 0;
        const y = 110 + laneCount * (depth >= 3 ? 68 : 88) + regionIndex * 42;
        const x = 110 + depth * 250 + regionIndex * 28;
        positions.set(node.node_id, { x, y });
        laneHeights.set(regionIndex, laneCount + 1);
      });
    });

  return positions;
}

function isPropagationEdge(edge, propagationPath) {
  for (let index = 0; index < propagationPath.length - 1; index += 1) {
    if (propagationPath[index] === edge.target_id && propagationPath[index + 1] === edge.source_id) {
      return true;
    }
  }
  return false;
}

function buildTrajectoryOverlay(trajectory = {}) {
  const heatmap = trajectory?.heatmap ?? [];
  const pathNodes = trajectory?.path_nodes ?? [];
  const nodeHeatmap = new Map();
  const pathOrder = new Map();
  const edgeSet = new Set();

  heatmap.forEach((entry) => {
    nodeHeatmap.set(entry.node_id, entry);
  });

  pathNodes.forEach((nodeId, index) => {
    pathOrder.set(nodeId, index);
  });

  for (const segment of trajectory?.path_segments ?? []) {
    const nodes = segment?.nodes ?? [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edgeSet.add(`${nodes[index + 1]}__${nodes[index]}`);
    }
  }

  return { nodeHeatmap, pathOrder, edgeSet };
}

export function buildFlowElements({ graph, activeAlarms = [], explainability, selectedNodeId, state, trajectory }) {
  if (!graph?.nodes?.length) {
    return { nodes: [], edges: [], nodeMap: new Map() };
  }

  const alarmMap = new Map(activeAlarms.map((alarm) => [alarm.node_id, alarm]));
  const trajectoryOverlay = buildTrajectoryOverlay(trajectory);
  const positions = createPositions(graph.nodes);
  const nodeMap = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const confirmedRootId = state?.episode_done ? state?.resolved_node_id ?? null : null;

  const nodes = graph.nodes.map((node) => {
    const suspect = explainability?.primaryCandidate?.nodeId === node.node_id;
    const alarm = alarmMap.get(node.node_id);
    const trajectoryNode = trajectoryOverlay.nodeHeatmap.get(node.node_id);
    return {
      id: node.node_id,
      type: "telecomNode",
      position: positions.get(node.node_id) ?? { x: 0, y: 0 },
      data: {
        ...node,
        alarm,
        config: LAYER_CONFIG[node.layer_name],
        isSelected: selectedNodeId === node.node_id,
        isSuspect: suspect,
        isConfirmedRoot: confirmedRootId === node.node_id,
        suspicionScore: explainability?.candidates?.find((candidate) => candidate.nodeId === node.node_id)?.confidence ?? 0,
        trajectoryVisitCount: trajectoryNode?.visit_count ?? 0,
        trajectoryIntensity: trajectoryNode?.intensity ?? 0,
        trajectoryOrder: trajectoryOverlay.pathOrder.get(node.node_id) ?? null,
        isTrajectoryHit: Boolean(trajectoryNode),
        isTrajectoryPath: trajectoryOverlay.pathOrder.has(node.node_id),
      },
    };
  });

  const edges = (graph.edges ?? []).map((edge) => {
    const trajectoryEdgeKey = `${edge.source_id}__${edge.target_id}`;
    const onTrajectoryPath = trajectoryOverlay.edgeSet.has(trajectoryEdgeKey);
    const animated =
      isPropagationEdge(edge, explainability?.propagationPath ?? []) ||
      alarmMap.has(edge.source_id) ||
      alarmMap.has(edge.target_id) ||
      onTrajectoryPath;

    const onCriticalPath = isPropagationEdge(edge, explainability?.propagationPath ?? []);
    const criticalStroke = "#D8D1C2";
    const softStroke = "rgba(216, 209, 194, 0.42)";
    return {
      id: `${edge.source_id}-${edge.target_id}`,
      source: edge.source_id,
      target: edge.target_id,
      type: "smoothstep",
      animated,
      style: {
        stroke: onTrajectoryPath
          ? "#C7904D"
          : onCriticalPath
            ? criticalStroke
            : animated
              ? softStroke
              : "rgba(216, 209, 194, 0.18)",
        strokeWidth: onTrajectoryPath ? 2.9 : onCriticalPath ? 2.5 : animated ? 1.8 : 1.2,
      },
    };
  });

  return { nodes, edges, nodeMap };
}

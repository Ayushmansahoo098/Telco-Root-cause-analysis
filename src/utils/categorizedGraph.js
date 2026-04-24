import { LAYER_CONFIG } from "@/utils/constants";
import { formatLayerLabel, formatRegion } from "@/utils/formatters";

const LAYER_ORDER = Object.keys(LAYER_CONFIG);

const NODE_SIZES = {
  region: {
    width: 286,
    height: 90,
  },
  layer: {
    width: 272,
    height: 82,
  },
  leaf: {
    width: 224,
    height: 240,
  },
};

const COLUMN_X = [56, 380, 724];
const ROOT_GAP = 36;
const CHILD_GAP = 18;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sortByLayerThenId(left, right) {
  const leftLayer = LAYER_ORDER.indexOf(left.data?.layer_name ?? "");
  const rightLayer = LAYER_ORDER.indexOf(right.data?.layer_name ?? "");

  if (leftLayer !== rightLayer) {
    if (leftLayer === -1) {
      return 1;
    }
    if (rightLayer === -1) {
      return -1;
    }
    return leftLayer - rightLayer;
  }

  const leftDepth = left.data?.depth ?? 0;
  const rightDepth = right.data?.depth ?? 0;

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return (left.id ?? "").localeCompare(right.id ?? "");
}

function countNodeHighlights(nodes) {
  const summary = nodes.reduce(
    (accumulator, node) => {
      if (node.data?.alarm) {
        accumulator.alarms += 1;
      }
      if (node.data?.status_name === "FAILED") {
        accumulator.failed += 1;
      } else if (node.data?.status_name === "DEGRADED") {
        accumulator.degraded += 1;
      }
      if (node.data?.isSelected || node.data?.isSuspect || node.data?.isConfirmedRoot) {
        accumulator.hot = true;
      }
      if (node.data?.isTrajectoryHit || node.data?.isTrajectoryPath) {
        accumulator.hot = true;
        accumulator.trajectory = (accumulator.trajectory ?? 0) + 1;
      }
      return accumulator;
    },
    {
      alarms: 0,
      failed: 0,
      degraded: 0,
      hot: false,
      trajectory: 0,
    },
  );
  summary.hot = summary.hot || summary.alarms > 0 || summary.failed > 0 || summary.degraded > 0;
  return summary;
}

function buildLeafNode(node, selectedNodeId, isSelectedBranch) {
  return {
    id: node.id,
    type: "telecomNode",
    position: { x: 0, y: 0 },
    style: {
      width: NODE_SIZES.leaf.width,
    },
    data: {
      ...node.data,
      layout: "categorized",
      isSelected: node.id === selectedNodeId,
      isHighlighted: isSelectedBranch,
    },
    children: [],
    width: NODE_SIZES.leaf.width,
    height: NODE_SIZES.leaf.height,
  };
}

function buildCategoryNode({
  id,
  categoryType,
  label,
  summary,
  isExpanded,
  isHot,
  children,
  onToggle,
}) {
  const base = categoryType === "region" ? NODE_SIZES.region : NODE_SIZES.layer;

  return {
    id,
    type: "categoryNode",
    position: { x: 0, y: 0 },
    style: {
      width: base.width,
    },
    data: {
      id,
      categoryType,
      label,
      summary,
      expanded: isExpanded,
      isHot,
      onToggle,
    },
    children,
    width: base.width,
    height: base.height,
    expanded: isExpanded,
  };
}

function measureTree(node) {
  if (!node.children.length || !node.expanded) {
    node.subtreeHeight = node.height;
    return node.subtreeHeight;
  }

  const childHeights = node.children.map((child) => measureTree(child));
  const stackedHeight =
    childHeights.reduce((sum, height) => sum + height, 0) + (node.children.length - 1) * CHILD_GAP;
  node.subtreeHeight = Math.max(node.height, stackedHeight);
  return node.subtreeHeight;
}

function assignTreePosition(node, depth, topY, flattenedNodes, flattenedEdges) {
  const x = COLUMN_X[Math.min(depth, COLUMN_X.length - 1)];
  node.position = {
    x,
    y: topY + (node.subtreeHeight - node.height) / 2,
  };

  flattenedNodes.push(node);

  if (!node.children.length || !node.expanded) {
    return;
  }

  let childTop = topY;
  for (const child of node.children) {
    const edgeId = `${node.id}__${child.id}`;
    flattenedEdges.push({
      id: edgeId,
      source: node.id,
      target: child.id,
      type: "smoothstep",
      animated: Boolean(node.data?.isHot || child.data?.isHot || child.data?.isSelected),
      style: {
        stroke: node.data?.isHot || child.data?.isHot || child.data?.isSelected
          ? "#D8D1C2"
          : "rgba(216, 209, 194, 0.32)",
        strokeWidth: node.data?.isHot || child.data?.isHot || child.data?.isSelected ? 2.4 : 1.6,
      },
    });
    assignTreePosition(child, depth + 1, childTop, flattenedNodes, flattenedEdges);
    childTop += child.subtreeHeight + CHILD_GAP;
  }
}

export function getRegionCategoryId(region) {
  return `region:${region}`;
}

export function getLayerCategoryId(region, layer) {
  return `layer:${region}:${layer}`;
}

export function buildCategorizedGraphElements({
  nodes = [],
  selectedNodeId = null,
  explainability,
  state,
  expandedCategoryIds = new Set(),
  onToggleCategory,
}) {
  if (!nodes.length) {
    return {
      nodes: [],
      edges: [],
      visibleLeafCount: 0,
      visibleCategoryCount: 0,
      regionCount: 0,
    };
  }

  const nodesByRegion = new Map();
  for (const node of nodes) {
    const region = node.data?.region ?? "default";
    const regionNodes = nodesByRegion.get(region) ?? [];
    regionNodes.push(node);
    nodesByRegion.set(region, regionNodes);
  }

  const selectedBranchNodeIds = new Set(
    [
      selectedNodeId,
      explainability?.primaryCandidate?.nodeId,
      ...(state?.episode_done && state?.resolved_node_id ? [state.resolved_node_id] : []),
      ...(explainability?.propagationPath ?? []),
    ].filter(Boolean),
  );

  const regionOrder = [...nodesByRegion.keys()].sort((left, right) => left.localeCompare(right));
  const rootNodes = [];

  for (const region of regionOrder) {
    const regionNodes = [...nodesByRegion.get(region)].sort(sortByLayerThenId);
    const regionId = getRegionCategoryId(region);
    const regionHasFocus = regionNodes.some((node) => selectedBranchNodeIds.has(node.id) || Boolean(node.data?.alarm));
    const regionExpanded = expandedCategoryIds.has(regionId);

    const nodesByLayer = new Map();
    for (const node of regionNodes) {
      const layer = node.data?.layer_name ?? "unknown";
      const layerNodes = nodesByLayer.get(layer) ?? [];
      layerNodes.push(node);
      nodesByLayer.set(layer, layerNodes);
    }

    const layerNodes = [];
    const knownLayers = LAYER_ORDER.filter((layer) => nodesByLayer.has(layer));
    const unknownLayers = [...nodesByLayer.keys()]
      .filter((layer) => !LAYER_ORDER.includes(layer))
      .sort((left, right) => left.localeCompare(right));
    const layerOrder = [...knownLayers, ...unknownLayers];

    for (const layer of layerOrder) {
      const telecomNodes = [...nodesByLayer.get(layer)].sort(sortByLayerThenId);
      const layerId = getLayerCategoryId(region, layer);
      const highlightInfo = countNodeHighlights(telecomNodes);
      const layerHasFocus = telecomNodes.some((node) => selectedBranchNodeIds.has(node.id) || Boolean(node.data?.alarm));
      const layerExpanded = expandedCategoryIds.has(layerId);

      const leafNodes = layerExpanded
        ? telecomNodes.map((node) => buildLeafNode(node, selectedNodeId, selectedBranchNodeIds.has(node.id)))
        : [];

      const layerSummaryBits = [pluralize(telecomNodes.length, "node")];
      if (highlightInfo.alarms) {
        layerSummaryBits.push(pluralize(highlightInfo.alarms, "alarm"));
      }
      if (highlightInfo.trajectory) {
        layerSummaryBits.push(pluralize(highlightInfo.trajectory, "trajectory hit"));
      }

      layerNodes.push(
        buildCategoryNode({
          id: layerId,
          categoryType: "layer",
          label: formatLayerLabel(layer),
          summary: layerSummaryBits.join(" · "),
          isExpanded: layerExpanded,
          isHot: highlightInfo.hot || layerHasFocus,
          children: leafNodes,
          onToggle: onToggleCategory,
        }),
      );
    }

    const regionHighlightInfo = countNodeHighlights(regionNodes);
    const regionSummaryBits = [pluralize(layerOrder.length, "group"), pluralize(regionNodes.length, "node")];
    if (regionHighlightInfo.alarms) {
      regionSummaryBits.push(pluralize(regionHighlightInfo.alarms, "alarm"));
    }
    if (regionHighlightInfo.trajectory) {
      regionSummaryBits.push(pluralize(regionHighlightInfo.trajectory, "trajectory hit"));
    }

    rootNodes.push(
      buildCategoryNode({
        id: regionId,
        categoryType: "region",
        label: formatRegion(region),
        summary: regionSummaryBits.join(" · "),
        isExpanded: regionExpanded,
        isHot: regionHighlightInfo.hot || regionHasFocus,
        children: regionExpanded ? layerNodes : [],
        onToggle: onToggleCategory,
      }),
    );
  }

  let cursorY = 28;
  const flattenedNodes = [];
  const flattenedEdges = [];

  for (const rootNode of rootNodes) {
    measureTree(rootNode);
    assignTreePosition(rootNode, 0, cursorY, flattenedNodes, flattenedEdges);
    cursorY += rootNode.subtreeHeight + ROOT_GAP;
  }

  return {
    nodes: flattenedNodes,
    edges: flattenedEdges,
    visibleLeafCount: flattenedNodes.filter((node) => node.type === "telecomNode").length,
    visibleCategoryCount: flattenedNodes.filter((node) => node.type === "categoryNode").length,
    regionCount: rootNodes.length,
  };
}

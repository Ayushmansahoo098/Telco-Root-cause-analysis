import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Info, RadioTower } from "lucide-react";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";

import { CategoryNode } from "@/components/Graph/CategoryNode";
import { NodeDetailCard } from "@/components/Graph/NodeDetailCard";
import { TelecomNode } from "@/components/Graph/TelecomNode";
import {
  buildCategorizedGraphElements,
} from "@/utils/categorizedGraph";

const nodeTypes = {
  categoryNode: CategoryNode,
  telecomNode: TelecomNode,
};

export function GraphPanel({
  flow,
  selectedNodeId,
  setSelectedNodeId,
  observation,
  explainability,
  runtimeState,
  onAction,
}) {
  const [expandedCategoryIds, setExpandedCategoryIds] = useState(() => new Set());
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [graphRequested, setGraphRequested] = useState(false);

  const selectedNode = useMemo(
    () => flow.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [flow.nodes, selectedNodeId],
  );

  useEffect(() => {
    if (!flow.nodes.length) {
      setGraphRequested(false);
    }
  }, [flow.nodes.length]);

  const toggleCategory = useCallback((categoryId) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const categorizedGraph = useMemo(
    () => {
      if (!graphRequested || !flow.nodes.length) {
        return {
          nodes: [],
          edges: [],
          visibleLeafCount: 0,
        };
      }

      return buildCategorizedGraphElements({
        nodes: flow.nodes,
        selectedNodeId,
        explainability,
        state: runtimeState,
        expandedCategoryIds,
        onToggleCategory: toggleCategory,
      });
    },
    [
      flow.nodes,
      selectedNodeId,
      explainability,
      runtimeState,
      expandedCategoryIds,
      toggleCategory,
      graphRequested,
    ],
  );

  useEffect(() => {
    if (!graphRequested || !reactFlowInstance || !categorizedGraph.nodes.length) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: 0.22,
        duration: 350,
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [graphRequested, reactFlowInstance, categorizedGraph.nodes.length, categorizedGraph.edges.length]);

  return (
    <section className="panel-shell flex min-h-[34rem] flex-col overflow-hidden">
      <div className="panel-header">
        <div>
          <p className="section-title">Network Graph Visualization</p>
          <p className="mt-1 text-sm text-cream/60">
            Expand region and layer groups to reveal the telecom nodes behind each outage path.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { label: "Healthy", color: "bg-healthy" },
            { label: "Suspected", color: "bg-suspect" },
            { label: "Failed", color: "bg-failure" },
          ].map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-2 rounded-full border border-cream/10 bg-black/10 px-3 py-1 text-xs font-semibold text-cream/70"
            >
              <span className={`h-2 w-2 rounded-full ${item.color}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-0">
        <div className="flow-shell telecom-grid relative min-h-[28rem] min-w-0">
          {graphRequested && categorizedGraph.nodes.length ? (
            <ReactFlow
              nodes={categorizedGraph.nodes}
              edges={categorizedGraph.edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.2}
              maxZoom={1.4}
              onlyRenderVisibleElements
              proOptions={{ hideAttribution: true }}
              onInit={setReactFlowInstance}
              onNodeClick={(_, node) => {
                if (node.type === "telecomNode") {
                  setSelectedNodeId(node.id);
                }
              }}
            >
              <Background gap={22} size={1} />
              <MiniMap
                pannable
                zoomable
                style={{ width: 148, height: 104 }}
                nodeColor={(node) => {
                  if (node.type === "categoryNode") {
                    return node.data?.categoryType === "region" ? "#6E5D59" : "#8E6F5D";
                  }
                  if (node.data?.isConfirmedRoot) {
                    return "#F56A6A";
                  }
                  if (node.data?.isSuspect) {
                    return "#F2B950";
                  }
                  return node.data?.status_name === "FAILED"
                    ? "#F56A6A"
                    : node.data?.status_name === "DEGRADED"
                      ? "#F2B950"
                      : "#D8D1C2";
                }}
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-cream/55">
              <div className="max-w-md rounded-[1.6rem] border border-cream/12 bg-black/15 p-6 shadow-soft backdrop-blur-xl">
                <p className="section-title">Graph Rendered On Demand</p>
                <p className="mt-3 text-sm leading-6 text-cream/65">
                  The dependency graph stays lightweight until you ask for it. Click below to
                  render the live graph, category nodes, and path evidence.
                </p>
                <button
                  type="button"
                  onClick={() => setGraphRequested(true)}
                  className="mt-5 inline-flex items-center justify-center rounded-full border border-bronze/40 bg-bronze/15 px-4 py-2 text-sm font-semibold text-bronze transition hover:bg-bronze/25"
                >
                  Render graph
                </button>
              </div>
            </div>
          )}

          {!selectedNode && graphRequested && categorizedGraph.nodes.length ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pointer-events-none absolute bottom-5 left-5 z-20 flex items-center gap-3 rounded-full border border-cream/12 bg-[#261718]/75 px-4 py-2 text-sm text-cream/65 shadow-soft backdrop-blur-xl"
            >
              <Info className="h-4 w-4 text-bronze" />
              Click a telecom node for details or expand a category with the arrow.
            </motion.div>
          ) : null}
        </div>

        <div className="border-t border-cream/10 bg-[#261718]/55 p-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.2rem] border border-cream/12 bg-[#261718]/75 px-4 py-3 shadow-soft backdrop-blur-xl">
              <p className="soft-label">Visible telecom nodes</p>
              <p className="mt-2 flex items-center gap-2 text-base font-semibold text-cream">
                <RadioTower className="h-4 w-4 text-bronze" />
                {graphRequested ? `${categorizedGraph.visibleLeafCount} visible nodes` : "Render graph to count"}
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-cream/12 bg-[#261718]/75 px-4 py-3 shadow-soft backdrop-blur-xl">
              <p className="soft-label">Propagation path</p>
              <p className="mt-2 flex items-center gap-2 text-base font-semibold text-cream">
                <Activity className="h-4 w-4 text-suspect" />
                {explainability?.propagationPath?.length ?? 0} hops
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-cream/12 bg-[#261718]/75 px-4 py-3 shadow-soft backdrop-blur-xl">
              <p className="soft-label">False positives</p>
              <p className="mt-2 flex items-center gap-2 text-base font-semibold text-cream">
                <AlertTriangle className="h-4 w-4 text-failure" />
                {runtimeState?.false_positives ?? 0}
              </p>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Selected Node</p>
              <p className="mt-1 text-sm text-cream/55">Details and RCA actions live here.</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {selectedNode ? (
              <NodeDetailCard key={selectedNode.id} node={selectedNode} onAction={onAction} variant="docked" />
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[1.6rem] border border-dashed border-cream/12 bg-black/10 p-4 text-sm text-cream/55"
              >
                Select a node in the graph to inspect its status, voltage, and alarm context.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

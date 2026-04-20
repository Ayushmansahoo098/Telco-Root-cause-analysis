import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Clock3, Download, FlameKindling, Route, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatActionCall, formatAlarmTime, formatLayerLabel, formatSimTime } from "@/utils/formatters";

function formatReward(value) {
  const amount = Number(value ?? 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toFixed(2)}`;
}

function renderRewardBreakdown(breakdown = {}) {
  return Object.entries(breakdown)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .slice(0, 4)
    .map(([key, value]) => (
      <span
        key={key}
        className="rounded-full border border-cream/10 bg-black/15 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cream/70"
      >
        {key.replaceAll("_", " ")} {formatReward(value)}
      </span>
    ));
}

export function TrajectoryPanel({ trajectory, onSelectNode }) {
  const [focusIndex, setFocusIndex] = useState(0);
  const stepLog = trajectory?.step_log ?? [];
  const heatmap = trajectory?.heatmap ?? [];
  const pathSegments = trajectory?.path_segments ?? [];
  const uniquePathNodes = trajectory?.path_nodes ?? [];
  const totalReward = Number(trajectory?.total_reward ?? 0);
  const uniqueNodesChecked = Number(trajectory?.unique_nodes_checked ?? 0);
  const uniqueLayersChecked = Number(trajectory?.unique_layers_checked ?? 0);
  const maxFocusIndex = Math.max(stepLog.length - 1, 0);

  useEffect(() => {
    setFocusIndex(maxFocusIndex);
  }, [maxFocusIndex, trajectory?.task]);

  const focusedStep = useMemo(() => {
    if (!stepLog.length) {
      return null;
    }
    return stepLog[Math.min(focusIndex, maxFocusIndex)] ?? stepLog[stepLog.length - 1] ?? null;
  }, [focusIndex, maxFocusIndex, stepLog]);

  const exportTrajectory = () => {
    if (!trajectory) {
      return;
    }

    const blob = new Blob([JSON.stringify(trajectory, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `telco-rca-trajectory-${trajectory.task ?? "episode"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="panel-shell flex h-full min-h-0 flex-col">
      <div className="panel-header">
        <div>
          <p className="section-title">Trajectory Panel</p>
          <p className="mt-1 text-sm text-cream/60">How the agent solved the episode, step by step.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="control-chip">
            <Clock3 className="h-4 w-4" />
            {formatSimTime(trajectory?.simulation_time_s ?? 0)}
          </span>
          <span className="control-chip">
            <FlameKindling className="h-4 w-4" />
            {formatReward(totalReward)} reward
          </span>
          <button type="button" className="control-chip" onClick={exportTrajectory} disabled={!trajectory}>
            <Download className="h-4 w-4" />
            Export JSON
          </button>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-4 overflow-y-auto p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="min-h-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Steps", value: trajectory?.total_steps ?? 0 },
              { label: "Checked nodes", value: uniqueNodesChecked },
              { label: "Checked layers", value: uniqueLayersChecked },
              { label: "Path nodes", value: uniquePathNodes.length },
            ].map((item) => (
              <div key={item.label} className="stat-card">
                <p className="soft-label">{item.label}</p>
                <p className="mt-2 text-2xl font-bold text-cream">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="surface-card flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3">
              <p className="soft-label">Action timeline</p>
              <span className="text-xs text-cream/55">Actions taken with timing and reward</span>
            </div>

            <div className="mt-4 rounded-[1.1rem] border border-cream/10 bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="soft-label">Replay scrubber</p>
                <span className="text-xs text-cream/55">
                  {stepLog.length ? `${focusIndex + 1} / ${stepLog.length}` : "0 / 0"}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className="control-chip"
                  onClick={() => setFocusIndex((current) => Math.max(0, current - 1))}
                  disabled={!stepLog.length || focusIndex <= 0}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Prev
                </button>
                <input
                  type="range"
                  min={0}
                  max={maxFocusIndex}
                  step={1}
                  value={Math.min(focusIndex, maxFocusIndex)}
                  onChange={(event) => setFocusIndex(Number(event.target.value))}
                  disabled={!stepLog.length}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-cream/10 accent-[var(--warm-core)]"
                />
                <button
                  type="button"
                  className="control-chip"
                  onClick={() => setFocusIndex((current) => Math.min(maxFocusIndex, current + 1))}
                  disabled={!stepLog.length || focusIndex >= maxFocusIndex}
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {focusedStep ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="rounded-[1rem] border border-cream/10 bg-cream/[0.05] p-4">
                    <p className="soft-label">Focused step</p>
                    <p className="break-anywhere mt-2 font-display text-[1.45rem] font-semibold leading-tight text-cream">
                      {formatActionCall(focusedStep.action_type, focusedStep.target_node_id)}
                    </p>
                    <p className="mt-2 text-xs text-cream/60">
                      {formatAlarmTime(focusedStep.simulation_time_s)} · +{Number(focusedStep.time_advanced_s ?? 0).toFixed(1)}s
                      {focusedStep.result ? ` · ${focusedStep.result.replaceAll("_", " ")}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {renderRewardBreakdown(focusedStep.reward_breakdown)}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cream/10 bg-black/15 px-3 py-1 text-xs font-semibold text-cream/70">
                        reward {formatReward(focusedStep.reward)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectNode?.(focusedStep.target_node_id)}
                        className="rounded-full border border-sand/20 bg-sand/10 px-3 py-1 text-xs font-semibold text-sand transition hover:bg-sand/15"
                      >
                        Focus node
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1rem] border border-cream/10 bg-cream/[0.05] p-4">
                    <p className="soft-label">Path nodes</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {focusedStep.path_nodes?.length ? (
                        focusedStep.path_nodes.map((nodeId, index) => (
                          <button
                            key={`${focusedStep.step}-${nodeId}`}
                            type="button"
                            onClick={() => onSelectNode?.(nodeId)}
                            className="inline-flex items-center gap-2 rounded-full border border-cream/10 bg-black/15 px-3 py-1.5 text-xs font-semibold text-cream/80 transition hover:border-sand/25 hover:text-cream"
                          >
                            <span className="rounded-full border border-cream/10 bg-cream/[0.06] px-2 py-0.5 text-[0.68rem]">
                              {index + 1}
                            </span>
                            <span className="break-anywhere">{nodeId}</span>
                          </button>
                        ))
                      ) : (
                        <p className="text-sm text-cream/55">No path captured for this step.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 min-h-0 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
              {stepLog.length ? (
                stepLog.map((step) => (
                  <motion.button
                    key={`${step.step}-${step.action_type}-${step.target_node_id}`}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(step.step * 0.03, 0.2) }}
                    onClick={() => onSelectNode?.(step.target_node_id)}
                    className="w-full rounded-[1.2rem] border border-cream/10 bg-cream/[0.04] p-4 text-left transition duration-200 hover:border-sand/20 hover:bg-cream/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="soft-label">Step {step.step}</p>
                        <p className="break-anywhere mt-1 font-display text-[1.35rem] font-semibold leading-tight text-cream">
                          {formatActionCall(step.action_type, step.target_node_id)}
                        </p>
                        <p className="mt-2 text-xs text-cream/60">
                          {formatAlarmTime(step.simulation_time_s)} · +{Number(step.time_advanced_s ?? 0).toFixed(1)}s
                          {step.result ? ` · ${step.result.replaceAll("_", " ")}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
                        step.reward > 0
                          ? "bg-healthy/15 text-healthy"
                          : step.reward < 0
                            ? "bg-failure/15 text-failure"
                            : "bg-sand/15 text-sand"
                      }`}>
                        {formatReward(step.reward)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {renderRewardBreakdown(step.reward_breakdown)}
                    </div>
                  </motion.button>
                ))
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-cream/12 bg-black/10 p-4 text-sm text-cream/55">
                  Run the agent or step through the episode to populate the timeline.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 space-y-4">
          <div className="surface-card flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3">
              <p className="soft-label flex items-center gap-2">
                <Route className="h-4 w-4 text-bronze" />
                Agent path through graph
              </p>
              <span className="text-xs text-cream/55">{pathSegments.length} traced segments</span>
            </div>

            <div className="mt-4 min-h-0 max-h-[11rem] space-y-3 overflow-y-auto pr-1">
              {pathSegments.length ? (
                pathSegments.map((segment) => (
                  <button
                    key={`${segment.step}-${segment.target_node_id}`}
                    type="button"
                    onClick={() => onSelectNode?.(segment.target_node_id)}
                    className="w-full rounded-[1.1rem] border border-cream/10 bg-black/10 p-3 text-left transition duration-200 hover:border-sand/20 hover:bg-cream/[0.05]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="soft-label">Step {segment.step}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-cream/72">
                          {segment.nodes.map((nodeId, index) => (
                            <span key={nodeId} className="inline-flex items-center gap-2">
                              <span className="rounded-full border border-cream/10 bg-cream/[0.05] px-2 py-0.5 font-semibold text-cream">
                                {nodeId}
                              </span>
                              {index < segment.nodes.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-cream/35" /> : null}
                            </span>
                          ))}
                        </p>
                      </div>
                      <span className="rounded-full border border-bronze/25 bg-bronze/10 px-2.5 py-1 text-xs font-semibold text-bronze">
                        {formatReward(segment.reward)}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[1.1rem] border border-dashed border-cream/12 bg-black/10 p-4 text-sm text-cream/55">
                  TRACE_PATH actions will appear here as breadcrumbs from the selected node back to the root.
                </div>
              )}
            </div>
          </div>

          <div className="surface-card flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3">
              <p className="soft-label flex items-center gap-2">
                <Waypoints className="h-4 w-4 text-bronze" />
                Heatmap of checked nodes
              </p>
              <span className="text-xs text-cream/55">Opacity reflects visit intensity</span>
            </div>

            <div className="mt-4 min-h-0 max-h-[18rem] overflow-y-auto pr-1">
              {heatmap.length ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
                  {heatmap.map((node) => {
                    const intensity = Math.max(0.08, Math.min(0.48, 0.08 + node.intensity * 0.42));
                    const isHot = node.is_alarm_source || node.is_checked || node.visit_count > 0;
                    return (
                      <button
                        key={node.node_id}
                        type="button"
                        onClick={() => onSelectNode?.(node.node_id)}
                        className="rounded-[1rem] border border-cream/10 p-3 text-left transition duration-200 hover:-translate-y-0.5"
                        style={{
                          backgroundColor: `rgba(199, 144, 77, ${intensity})`,
                          boxShadow: isHot ? "0 0 0 1px rgba(199, 144, 77, 0.2)" : "none",
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-anywhere font-display text-lg font-semibold leading-none text-black">
                              {node.node_id}
                            </p>
                            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.22em] text-black/58">
                              {formatLayerLabel(node.layer)}
                            </p>
                          </div>
                          <span className="rounded-full border border-black/10 bg-black/10 px-2.5 py-1 text-xs font-semibold text-black">
                            x{Number(node.visit_count).toFixed(1).replace(/\.0$/, "")}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-black/72">
                          {node.region} · {node.status_name}
                        </p>
                        <p className="mt-2 text-xs text-black/58">
                          first seen {node.first_seen_step} · last seen {node.last_seen_step}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[1.1rem] border border-dashed border-cream/12 bg-black/10 p-4 text-sm text-cream/55">
                  Checked nodes will appear here as a heatmap once the agent starts exploring the network.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

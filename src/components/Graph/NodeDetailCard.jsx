import { Gauge, Route, Search, ShieldCheck, TriangleAlert, Zap } from "lucide-react";
import { motion } from "framer-motion";

import { ACTION_LABELS, MANUAL_ACTIONS } from "@/utils/constants";
import { formatLayerLabel, formatRegion } from "@/utils/formatters";

const actionIcons = {
  CHECK_LOGS: Search,
  CHECK_VOLTAGE: Gauge,
  TRACE_PATH: Route,
  RESTART: Zap,
  DIAGNOSE: ShieldCheck,
};

const actionButtons = MANUAL_ACTIONS.map((action) => ({
  action,
  Icon: actionIcons[action],
  label: ACTION_LABELS[action] ?? action,
}));

export function NodeDetailCard({ node, onAction, variant = "panel" }) {
  if (!node) {
    return null;
  }

  const data = node.data ?? node;
  const isOverlay = variant === "overlay";
  const isDocked = variant === "docked";
  const containerClass =
    isOverlay
      ? "pointer-events-auto absolute bottom-5 left-5 z-20 w-full max-w-sm overflow-hidden rounded-[1.6rem] border border-cream/12 bg-[#261718]/92 p-4 shadow-panel backdrop-blur-xl"
      : "pointer-events-auto w-full overflow-hidden rounded-[1.6rem] border border-cream/12 bg-[#261718]/92 p-4 shadow-panel backdrop-blur-xl";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={containerClass}
    >
      {isDocked ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="soft-label">Node status</p>
                <h3 className="break-anywhere mt-2 font-display text-[1.75rem] font-semibold leading-none text-cream">
                  {data.node_id}
                </h3>
                <p className="break-anywhere mt-1 text-sm text-cream/62">
                  {formatLayerLabel(data.layer_name)} · {formatRegion(data.region)}
                </p>
              </div>
              <div className="shrink-0 rounded-full border border-suspect/25 bg-suspect/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-suspect">
                {data.status_name}
              </div>
            </div>

            {data.alarm ? (
              <div className="mt-4 rounded-[1rem] border border-failure/20 bg-failure/[0.08] p-3">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4 text-failure" />
                  <p className="soft-label">Alarm context</p>
                </div>
                <p className="clamp-3 break-anywhere mt-2 text-sm text-cream/68">{data.alarm.message}</p>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[1rem] border border-cream/10 bg-black/15 p-3">
                <p className="soft-label">Voltage</p>
                <p className="mt-2 font-display text-2xl font-semibold text-cream">
                  {Number(data.voltage_v ?? 0).toFixed(1)}V
                </p>
              </div>
              <div className="rounded-[1rem] border border-cream/10 bg-black/15 p-3">
                <p className="soft-label">Temperature</p>
                <p className="mt-2 font-display text-2xl font-semibold text-cream">
                  {Number(data.temperature_c ?? 0).toFixed(1)}°C
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
              {actionButtons.map(({ action, Icon, label }) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAction?.(action, data.node_id)}
                  className="secondary-btn justify-center text-xs"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="soft-label">Node status</p>
              <h3 className="break-anywhere mt-2 font-display text-[1.75rem] font-semibold leading-none text-cream">
                {data.node_id}
              </h3>
              <p className="break-anywhere mt-1 text-sm text-cream/62">
                {formatLayerLabel(data.layer_name)} · {formatRegion(data.region)}
              </p>
            </div>
            <div className="shrink-0 rounded-full border border-suspect/25 bg-suspect/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-suspect">
              {data.status_name}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[1rem] border border-cream/10 bg-black/15 p-3">
              <p className="soft-label">Voltage</p>
              <p className="mt-2 font-display text-2xl font-semibold text-cream">
                {Number(data.voltage_v ?? 0).toFixed(1)}V
              </p>
            </div>
            <div className="rounded-[1rem] border border-cream/10 bg-black/15 p-3">
              <p className="soft-label">Temperature</p>
              <p className="mt-2 font-display text-2xl font-semibold text-cream">
                {Number(data.temperature_c ?? 0).toFixed(1)}°C
              </p>
            </div>
          </div>

          {data.alarm ? (
            <div className="mt-4 rounded-[1rem] border border-failure/20 bg-failure/[0.08] p-3">
              <div className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-failure" />
                <p className="soft-label">Alarm context</p>
              </div>
              <p className="clamp-3 break-anywhere mt-2 text-sm text-cream/68">{data.alarm.message}</p>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {actionButtons.map(({ action, Icon, label }) => (
              <button
                key={action}
                type="button"
                onClick={() => onAction?.(action, data.node_id)}
                className="secondary-btn justify-center text-xs"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

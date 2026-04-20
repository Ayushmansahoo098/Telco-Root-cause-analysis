import { memo } from "react";
import { BatteryCharging, Cpu, RadioTower, Server } from "lucide-react";
import { Handle, Position } from "reactflow";

import { formatPercentage } from "@/utils/formatters";

function pickIcon(layer) {
  if (layer === "power_unit") {
    return BatteryCharging;
  }
  if (layer === "core_switch") {
    return Server;
  }
  if (layer === "radio_controller") {
    return Cpu;
  }
  return RadioTower;
}

function statusTone(status) {
  if (status === "FAILED") {
    return "border-failure/40 bg-failure/10 text-failure";
  }
  if (status === "DEGRADED") {
    return "border-suspect/40 bg-suspect/10 text-suspect";
  }
  return "border-healthy/30 bg-healthy/10 text-healthy";
}

export const TelecomNode = memo(({ data }) => {
  const Icon = pickIcon(data.layer_name);
  const classes = [
    "telecom-node",
    data.isSelected ? "selected" : "",
    data.isHighlighted ? "highlighted" : "",
    data.isSuspect ? "suspect pulse" : "",
    data.isConfirmedRoot ? "confirmed pulse" : "",
    data.isTrajectoryPath ? "trajectory-path" : "",
    data.isTrajectoryHit ? "trajectory-hit" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`${classes} group`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-black/10 bg-black/5 p-2 transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-5 w-5 text-black/80" />
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] ${statusTone(data.status_name)}`}>
          {data.status_name}
        </div>
      </div>

      <p className="mt-4 text-[0.62rem] font-bold uppercase tracking-[0.24em] text-black/40">
        {data.config?.shortLabel}
      </p>
      <p className="break-anywhere mt-1 font-display text-[2.1rem] font-extrabold leading-none tracking-tight text-black">
        {data.node_id}
      </p>
      <p className="break-anywhere mt-2.5 text-[0.82rem] font-medium leading-normal text-black/70">
        {data.config?.role}
      </p>

      <div className="mt-5 flex items-center justify-between text-[0.7rem] font-bold tracking-wider text-black/40">
        <span>{data.region}</span>
        <span className="text-black/80">{formatPercentage(data.suspicionScore ?? 0)}</span>
      </div>
      {data.trajectoryVisitCount ? (
        <div className="mt-3 flex justify-between">
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-black/70">
            Trajectory
          </span>
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[0.75rem] font-semibold text-black/70">
            x{Number(data.trajectoryVisitCount).toFixed(1).replace(/\.0$/, "")}
          </span>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
});

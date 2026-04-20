import { ACTION_API_NAMES, LAYER_CONFIG, TASK_METADATA } from "@/utils/constants";
 
export function formatLayerLabel(layer) {
  return LAYER_CONFIG[layer]?.label ?? layer;
}
 
export function formatRegion(region) {
  if (!region) {
    return "Unknown region";
  }
 
  return region
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
 
export function formatSimTime(value) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }
 
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}
 
export function formatAlarmTime(seconds) {
  return `T+${Number(seconds ?? 0).toFixed(1)}s`;
}
 
export function formatPercentage(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}
 
export function formatActionCall(actionType, nodeId) {
  return `${ACTION_API_NAMES[actionType] ?? actionType.toLowerCase()}(id=${nodeId})`;
}
 
export function formatActionResult(actionType, info = {}) {
  if (!info || typeof info !== "object") {
    return "Action processed";
  }
 
  if (info.error) {
    return info.error;
  }
 
  if (actionType === "CHECK_LOGS") {
    const status = info.status === "FAILED" ? "DOWN" : info.status ?? "UNKNOWN";
    return `Node is ${status}`;
  }
 
  if (actionType === "CHECK_VOLTAGE") {
    return `Voltage ${Number(info.voltage_v ?? 0).toFixed(1)}V (${info.status ?? "UNKNOWN"})`;
  }
 
  if (actionType === "TRACE_PATH") {
    return `Upstream path depth ${info.depth ?? 0}`;
  }
 
  if (actionType === "RESTART") {
    return info.result === "ROOT_CAUSE_FIXED" ? "Outage cleared" : "Restart failed";
  }
 
  if (actionType === "DIAGNOSE") {
    return info.result === "CORRECT_DIAGNOSIS" ? "Root cause submitted" : "Hypothesis rejected";
  }
 
  return "Action processed";
}
 
export function buildAgentTranscriptText(transcript) {
  if (!transcript) {
    return "[START]\nTask 0: Awaiting Simulation";
  }
 
  const taskMeta = TASK_METADATA[transcript.task] ?? { index: 0, title: "Awaiting Simulation" };
  const lines = ["[START]", `Task ${taskMeta.index}: ${taskMeta.title}`, ""];
 
  for (const step of transcript.steps) {
    lines.push("[STEP]");
    lines.push(`Action: ${step.action}`);
    if (step.result) {
      lines.push(`Result: ${step.result}`);
    }
    lines.push("");
  }
 
  if (transcript.final) {
    lines.push("[END]");
    lines.push(`Final Score: ${Number(transcript.final.score ?? 0).toFixed(2)}`);
    lines.push(`MTTR: ${transcript.final.mttrSteps ?? 0} steps`);
  }
 
  return lines.join("\n").trim();
}
 
export function summarizeEnvironmentResponse(info = {}) {
  if (!info || typeof info !== "object") {
    return [];
  }
 
  function normalizeValue(value) {
    if (Array.isArray(value)) {
      if (!value.length) {
        return "[]";
      }
 
      if (typeof value[0] === "object") {
        return value
          .slice(0, 3)
          .map((item) => item.node_id ?? JSON.stringify(item))
          .join(" → ");
      }
 
      return value.join(", ");
    }
 
    if (value && typeof value === "object") {
      return Object.entries(value)
        .slice(0, 3)
        .map(([key, entryValue]) => `${key}: ${entryValue}`)
        .join(" · ");
    }
 
    return String(value);
  }
 
  const entries = Object.entries(info).filter(([, value]) => value !== null && value !== undefined);
  return entries.slice(0, 6).map(([key, value]) => {
    return {
      label: key.replaceAll("_", " "),
      value: normalizeValue(value),
    };
  });
}
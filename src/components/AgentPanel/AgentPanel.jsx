import { motion } from "framer-motion";
import { Bot, FileSearch, Radar } from "lucide-react";

import { buildAgentTranscriptText, formatActionCall, summarizeEnvironmentResponse } from "@/utils/formatters";

export function AgentPanel({ transcript, latestAction, latestInfo, error, isRunningAgent }) {
  const transcriptText = buildAgentTranscriptText(transcript);
  const responseItems = summarizeEnvironmentResponse(latestInfo);

  return (
    <section className="panel-shell flex h-full min-h-[28rem] flex-col">
      <div className="panel-header">
        <div>
          <p className="section-title">Agent Actions + Logs</p>
          <p className="mt-1 text-sm text-cream/60">Step-by-step RCA decisions and environment responses.</p>
        </div>
        <span className="control-chip">
          <Bot className="h-4 w-4" />
          {isRunningAgent ? "Autopilot" : "Manual step mode"}
        </span>
      </div>

      <div className="grid flex-1 gap-4 p-5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="surface-card"
        >
          <div className="flex items-center gap-3">
            <Radar className="h-5 w-5 text-bronze" />
            <div>
              <p className="soft-label">Current action</p>
              <p className="break-anywhere mt-1 font-display text-[1.55rem] font-semibold leading-none text-cream">
                {latestAction
                  ? formatActionCall(latestAction.actionType, latestAction.targetNodeId)
                  : "Awaiting operator or agent step"}
              </p>
            </div>
          </div>
        </motion.div>

        <div className="surface-card">
          <div className="flex items-center gap-3">
            <FileSearch className="h-5 w-5 text-suspect" />
            <div>
              <p className="soft-label">Environment response</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {responseItems.length ? (
                  responseItems.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="rounded-[1rem] border border-cream/10 bg-cream/[0.05] p-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.24em] text-cream/45">{item.label}</p>
                      <p className="break-anywhere mt-2 text-sm font-medium text-cream/75">{item.value}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-cream/55">No action has been executed yet.</p>
                )}
              </div>
            </div>
          </div>
          {error ? <p className="mt-4 text-sm font-semibold text-failure">{error}</p> : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col rounded-[1.45rem] border border-cream/10 bg-[#221014]/78 p-4 shadow-soft">
          <p className="soft-label">Execution transcript</p>
          <pre className="mt-4 flex-1 overflow-auto whitespace-pre-wrap rounded-[1rem] border border-cream/10 bg-black/20 p-4 font-mono text-sm leading-7 text-cream/80">
            {transcriptText}
          </pre>
        </div>
      </div>
    </section>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { BellRing } from "lucide-react";

import { formatAlarmTime } from "@/utils/formatters";

function severityStyles(severity) {
  if (severity === "CRITICAL") {
    return "border-failure/35 bg-failure/[0.1]";
  }
  if (severity === "MAJOR") {
    return "border-suspect/35 bg-suspect/[0.1]";
  }
  return "border-cream/10 bg-black/10";
}

export function AlarmPanel({ alarms, totalAlarmCount, selectedNodeId, onSelectNode }) {
  return (
    <section className="panel-shell flex h-full min-h-[32rem] flex-col xl:min-h-0">
      <div className="panel-header">
        <div>
          <p className="section-title">Alarm Feed</p>
          <p className="mt-1 text-sm text-cream/60">Live propagation from impacted telecom nodes.</p>
        </div>
        <div className="rounded-full border border-cream/10 bg-black/10 px-3 py-1 text-sm font-semibold text-cream">
          {alarms.length} / {totalAlarmCount}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <AnimatePresence initial={false}>
          {alarms.map((alarm, index) => {
            const selected = selectedNodeId === alarm.node_id;
            return (
              <motion.button
                key={alarm.alarm_id}
                type="button"
                onClick={() => onSelectNode(alarm.node_id)}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.24, delay: Math.min(index * 0.02, 0.16) }}
                className={`alarm-ticker-enter w-full rounded-[1.3rem] border p-4 text-left transition ${
                  selected
                    ? "border-sand/40 bg-gradient-to-r from-sand/[0.18] to-bronze/[0.08] shadow-glow"
                    : severityStyles(alarm.severity)
                } ${alarm.severity === "CRITICAL" ? "alarm-critical" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 rounded-full border border-cream/10 bg-black/15 p-2">
                      <BellRing className="h-4 w-4 text-bronze" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-anywhere font-display text-[1.7rem] font-semibold leading-none text-cream">
                          {alarm.node_id}
                        </p>
                        <span className="rounded-full border border-cream/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-cream/70">
                          {alarm.severity}
                        </span>
                        {alarm.is_noise ? (
                          <span className="rounded-full border border-cream/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-suspect">
                            noise
                          </span>
                        ) : null}
                      </div>
                      <p className="clamp-3 break-anywhere mt-2 text-sm leading-6 text-cream/68">
                        {alarm.message}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.22em] text-cream/45">
                    {formatAlarmTime(alarm.timestamp)}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>

        {!alarms.length ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-[1.4rem] border border-dashed border-cream/12 bg-black/10 px-6 text-center text-sm text-cream/55">
            Reset the simulation to stream alarms into the RCA feed.
          </div>
        ) : null}
      </div>
    </section>
  );
}

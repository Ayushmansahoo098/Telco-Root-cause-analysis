import { Activity, ArrowLeft, Bot, Play, RefreshCw, SlidersHorizontal, StepForward } from "lucide-react";

import { TASK_METADATA } from "@/utils/constants";
import { formatPercentage, formatSimTime } from "@/utils/formatters";

export function TaskSelector({
  task,
  tasks,
  observation,
  runtimeState,
  grade,
  socketStatus,
  isLoading,
  isRunningAgent,
  showNoise,
  onTaskChange,
  onReset,
  onRun,
  onStep,
  onReturn,
  onToggleNoise,
}) {
  const taskCards = tasks.length
    ? tasks.map((entry) => ({
        key: entry.name,
        title: TASK_METADATA[entry.name]?.title ?? entry.name,
        description: entry.description,
      }))
    : Object.entries(TASK_METADATA).map(([key, value]) => ({
        key,
        title: value.title,
        description: value.operatorStory,
      }));

  return (
    <header className="panel-shell p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onReturn} className="ghost-btn">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div>
              <p className="section-title">Telco-RCA Mission Control</p>
              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-cream">
                AI agent reasoning for 5G outage isolation
              </h1>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {taskCards.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => onTaskChange(card.key)}
                className={`flex flex-col gap-1 rounded-[1.1rem] border px-4 py-2.5 text-left transition-all ${
                  task === card.key
                    ? "border-bronze bg-bronze/10 ring-1 ring-bronze/30"
                    : "border-cream/10 bg-black/10 hover:border-cream/25 hover:bg-black/20"
                }`}
              >
                <span className={`text-[0.62rem] font-bold uppercase tracking-[0.15em] ${
                  task === card.key ? "text-bronze" : "text-cream/40"
                }`}>
                  Scenario
                </span>
                <span className={`text-xs font-bold ${
                  task === card.key ? "text-cream" : "text-cream/65"
                }`}>
                  {card.title}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:items-end">
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => onReset(task)} disabled={isLoading} className="secondary-btn">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Reset Simulation
            </button>
            <button
              type="button"
              onClick={onStep}
              disabled={isLoading || !observation}
              className="secondary-btn"
            >
              <StepForward className="h-4 w-4" />
              Next Step
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={isLoading || isRunningAgent || !observation}
              className="primary-btn"
            >
              <Play className="h-4 w-4" />
              {isRunningAgent ? "Running..." : "Run Agent"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onToggleNoise} className="control-chip">
              <SlidersHorizontal className="h-4 w-4" />
              {showNoise ? "Noise Visible" : "Noise Filtered"}
            </button>
            <span className="control-chip">
              <Activity className="h-4 w-4" />
              {socketStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="stat-card">
          <p className="soft-label">Simulation time</p>
          <p className="break-anywhere mt-2 font-display text-3xl font-semibold text-cream">
            {formatSimTime(observation?.simulation_time_s ?? runtimeState?.simulation_time_s)}
          </p>
        </div>
        <div className="stat-card">
          <p className="soft-label">Alarm volume</p>
          <p className="break-anywhere mt-2 font-display text-3xl font-semibold text-cream">
            {observation?.total_alarm_count ?? 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="soft-label">Steps used</p>
          <p className="break-anywhere mt-2 font-display text-3xl font-semibold text-cream">
            {runtimeState?.steps_taken ?? 0}
            <span className="text-base text-cream/55">
              {" "}
              / {(runtimeState?.steps_taken ?? 0) + (observation?.steps_remaining ?? 0)}
            </span>
          </p>
        </div>
        <div className="stat-card">
          <p className="soft-label">Judge projection</p>
          <p className="break-anywhere mt-2 flex items-center gap-2 font-display text-3xl font-semibold text-cream">
            <Bot className="h-5 w-5 text-bronze" />
            {formatPercentage(grade?.score ?? 0)}
          </p>
        </div>
      </div>
    </header>
  );
}

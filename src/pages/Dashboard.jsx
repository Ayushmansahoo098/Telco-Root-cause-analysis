import { lazy, Suspense, memo } from "react";

import { TaskSelector } from "@/components/TaskSelector";

// Memoized panels to prevent unnecessary re-renders when other state changes
const AlarmPanel = memo(lazy(() =>
  import("@/components/AlarmPanel/AlarmPanel").then((module) => ({
    default: module.AlarmPanel,
  })),
));
const AgentPanel = memo(lazy(() =>
  import("@/components/AgentPanel/AgentPanel").then((module) => ({
    default: module.AgentPanel,
  })),
));
const ExplainabilityPanel = memo(lazy(() =>
  import("@/components/ExplainabilityPanel").then((module) => ({
    default: module.ExplainabilityPanel,
  })),
));
const GraphPanel = memo(lazy(() =>
  import("@/components/Graph/GraphPanel").then((module) => ({
    default: module.GraphPanel,
  })),
));
const MetricsPanel = memo(lazy(() =>
  import("@/components/Metrics/MetricsPanel").then((module) => ({
    default: module.MetricsPanel,
  })),
));
const TrajectoryPanel = memo(lazy(() =>
  import("@/components/TrajectoryPanel/TrajectoryPanel").then((module) => ({
    default: module.TrajectoryPanel,
  })),
));

function PanelSkeleton({ title, minHeight = "min-h-[20rem]", lines = 3 }) {
  return (
    <section className={`panel-shell flex ${minHeight} flex-col overflow-hidden`}>
      <div className="panel-header">
        <div>
          <p className="section-title">{title}</p>
          <div className="mt-2 h-3 w-40 animate-pulse rounded-full bg-white/10" />
        </div>
        <div className="h-7 w-24 animate-pulse rounded-full bg-white/10" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={`skeleton-${title}-${index}`}
            className={`h-4 animate-pulse rounded-full bg-white/10 ${
              index === 0 ? "w-3/5" : index === 1 ? "w-4/5" : "w-2/5"
            }`}
          />
        ))}
      </div>
    </section>
  );
}

export function Dashboard({
  task,
  tasks,
  observation,
  runtimeState,
  grade,
  filteredAlarms,
  explainability,
  flow,
  metricsHistory,
  trajectory,
  transcript,
  latestAction,
  latestInfo,
  selectedNodeId,
  setSelectedNodeId,
  showNoise,
  setShowNoise,
  isLoading,
  isRunningAgent,
  error,
  socketStatus,
  resetCurrentSimulation,
  executeAction,
  stepAgent,
  runAgent,
  onReturnToLanding,
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1660px] flex-col gap-4 px-4 py-4 lg:px-6">
      <TaskSelector
        task={task}
        tasks={tasks}
        observation={observation}
        runtimeState={runtimeState}
        grade={grade}
        socketStatus={socketStatus}
        isLoading={isLoading}
        isRunningAgent={isRunningAgent}
        showNoise={showNoise}
        onTaskChange={resetCurrentSimulation}
        onReset={resetCurrentSimulation}
        onRun={runAgent}
        onStep={stepAgent}
        onReturn={onReturnToLanding}
        onToggleNoise={() => setShowNoise((current) => !current)}
      />

      <div className="grid flex-1 min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)_auto]">
        <div className="xl:row-span-2">
          <Suspense fallback={<PanelSkeleton title="Alarm Feed" minHeight="min-h-[32rem]" lines={4} />}>
            <AlarmPanel
              alarms={filteredAlarms}
              totalAlarmCount={observation?.total_alarm_count ?? 0}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </Suspense>
        </div>

        <Suspense fallback={<PanelSkeleton title="Network Graph Visualization" minHeight="min-h-[34rem]" lines={4} />}>
          <GraphPanel
            flow={flow}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            observation={observation}
            explainability={explainability}
            runtimeState={runtimeState}
            onAction={(actionType, nodeId) =>
              executeAction({
                actionType,
                targetNodeId: nodeId,
                source: "manual",
              })
            }
          />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Agent Actions + Logs" minHeight="min-h-[28rem]" lines={3} />}>
          <AgentPanel
            transcript={transcript}
            latestAction={latestAction}
            latestInfo={latestInfo}
            error={error}
            isRunningAgent={isRunningAgent}
          />
        </Suspense>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <Suspense fallback={<PanelSkeleton title="Explainability Panel" minHeight="min-h-[14rem]" lines={3} />}>
            <ExplainabilityPanel explainability={explainability} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton title="Metrics Panel" minHeight="min-h-[24rem]" lines={4} />}>
            <MetricsPanel
              metricsHistory={metricsHistory}
              runtimeState={runtimeState}
              observation={observation}
              grade={grade}
            />
          </Suspense>
          <Suspense fallback={<PanelSkeleton title="Trajectory Panel" minHeight="min-h-[26rem]" lines={5} />}>
            <TrajectoryPanel trajectory={trajectory} onSelectNode={setSelectedNodeId} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

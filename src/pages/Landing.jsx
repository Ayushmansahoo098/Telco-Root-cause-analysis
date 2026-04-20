import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, Network, ShieldAlert, Waypoints } from "lucide-react";

import { TASK_METADATA } from "@/utils/constants";

const ambientNodes = [
  { id: "a", x: 10, y: 30 },
  { id: "b", x: 26, y: 56 },
  { id: "c", x: 30, y: 24 },
  { id: "d", x: 46, y: 48 },
  { id: "e", x: 58, y: 26 },
  { id: "f", x: 66, y: 60 },
  { id: "g", x: 82, y: 36 },
  { id: "h", x: 90, y: 54 },
];

const ambientEdges = [
  ["a", "b"],
  ["a", "c"],
  ["c", "d"],
  ["d", "e"],
  ["d", "f"],
  ["e", "g"],
  ["f", "g"],
  ["g", "h"],
];

function AmbientNetwork() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="h-full w-full opacity-65" viewBox="0 0 100 100" preserveAspectRatio="none">
        {ambientEdges.map(([fromId, toId]) => {
          const from = ambientNodes.find((node) => node.id === fromId);
          const to = ambientNodes.find((node) => node.id === toId);
          return (
            <motion.line
              key={`${fromId}-${toId}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="ambient-line"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 2.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
            />
          );
        })}

        {ambientNodes.map((node, index) => (
          <motion.circle
            key={node.id}
            cx={node.x}
            cy={node.y}
            r="1.2"
            fill={index % 3 === 0 ? "#B45C64" : index % 2 === 0 ? "#B88A6A" : "#D8D1C2"}
            animate={{
              scale: [1, 1.4, 1],
              opacity: [0.45, 1, 0.45],
            }}
            transition={{
              duration: 2.8,
              repeat: Infinity,
              ease: "easeInOut",
              delay: index * 0.18,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

export function Landing({ activeTask, onSelectTask, onLaunch, loading }) {
  return (
    <main className="relative isolate mx-auto flex min-h-screen max-w-[1440px] flex-col items-center justify-center px-6 py-10 lg:px-10">
      <AmbientNetwork />

      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: "easeOut" }}
        className="relative z-10 text-center"
      >

        <h1 className="break-anywhere mt-8 font-display text-5xl font-semibold leading-[0.9] tracking-tight text-cream sm:text-7xl lg:text-8xl">
          AI-Powered
          <span className="block text-sand">Telecom Root Cause Analysis</span>
        </h1>

        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-cream/75 sm:text-xl">
          A refined telecom operations experience designed to make graph-based RCA immediately understandable.
          Select a scenario below to begin the autonomous troubleshooting simulation.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={() => onLaunch(activeTask)}
            disabled={loading}
            className="primary-btn scale-110"
          >
            Launch Chosen Simulation
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.75, ease: "easeOut", delay: 0.15 }}
        className="relative z-10 mt-20 w-full"
      >
        <div className="mb-8 flex items-baseline justify-between border-b border-cream/10 pb-4">
          <h2 className="section-title">Select Operational Scenario</h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(TASK_METADATA).map(([taskKey, meta]) => {
            const isActive = taskKey === activeTask;
            return (
              <motion.button
                key={taskKey}
                type="button"
                whileHover={{ y: -6 }}
                onClick={() => onSelectTask(taskKey)}
                className={`relative group flex flex-col overflow-hidden rounded-[2rem] border p-6 text-left transition-all duration-500 ${
                  isActive
                    ? "border-sand/50 bg-gradient-to-br from-sand/[0.12] to-bronze/10 shadow-glow ring-2 ring-sand/20"
                    : "border-cream/10 bg-black/10 hover:border-sand/30 hover:bg-cream/[0.04]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${meta.accent} transition-opacity duration-500 ${
                    isActive ? "opacity-80" : "opacity-30 group-hover:opacity-50"
                  }`}
                />
                
                <div className="relative z-10 mb-auto">
                  <div className="flex items-center justify-between">
                    <p className="soft-label">{`Scenario 0${meta.index}`}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-widest ${
                      isActive ? "bg-sand text-espresso" : "bg-cream/10 text-cream/70"
                    }`}>
                      {meta.shortLabel}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-[1.85rem] font-semibold leading-tight text-cream">
                    {meta.title}
                  </h3>
                </div>

                <div className="relative z-10 mt-6 space-y-4">
                  <p className="break-anywhere text-sm leading-relaxed text-cream/72">
                    {meta.description}
                  </p>
                  <div className={`h-1 w-12 rounded-full transition-all duration-500 ${
                    isActive ? "bg-sand w-full" : "bg-cream/10 group-hover:bg-sand/40"
                  }`} />
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.section>
    </main>
  );
}

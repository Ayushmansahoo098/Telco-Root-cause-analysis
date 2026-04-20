import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useState } from "react";

import { Landing } from "@/pages/Landing";
import { useSimulation } from "@/hooks/useSimulation";

const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);

function DashboardLoading() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-4xl items-center justify-center rounded-[1.8rem] border border-cream/10 bg-[#261718]/78 px-6 py-10 text-center text-cream/70 shadow-panel backdrop-blur-xl">
      <div>
        <p className="section-title">Loading Mission Control</p>
        <p className="mt-3 text-lg text-cream/70">
          Splitting the dashboard bundle so the heavy graph and metrics code load only when needed.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const simulation = useSimulation();
  const [view, setView] = useState("landing");

  const handleLaunch = async (task) => {
    setView("dashboard");
    await simulation.resetCurrentSimulation(task);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-espresso font-body text-cream">
      <div className="pointer-events-none absolute inset-0 bg-mesh opacity-90" />
      <div className="pointer-events-none absolute inset-0 noise-pattern opacity-40" />
      <div className="pointer-events-none hero-grid absolute inset-0 opacity-70" />
      <motion.div
        className="ambient-bloom absolute -left-20 top-10 h-72 w-72 rounded-full bg-sand/20"
        animate={{ x: [0, 24, 0], y: [0, -16, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="ambient-bloom absolute right-0 top-24 h-96 w-96 rounded-full bg-claret/40"
        animate={{ x: [0, -28, 0], y: [0, 20, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="ambient-bloom absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-bronze/15"
        animate={{ x: [0, 18, 0], y: [0, -22, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />

      <AnimatePresence mode="wait">
        {view === "landing" ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <Landing
              activeTask={simulation.task}
              onSelectTask={simulation.setTask}
              onLaunch={handleLaunch}
              loading={simulation.isLoading}
            />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -22 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <Suspense fallback={<DashboardLoading />}>
              <Dashboard
                {...simulation}
                onReturnToLanding={() => {
                  simulation.stopAgent();
                  setView("landing");
                }}
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

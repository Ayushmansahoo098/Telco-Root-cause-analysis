import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPercentage } from "@/utils/formatters";

export function MetricsPanel({ metricsHistory, runtimeState, observation, grade }) {
  const mttrData = [
    {
      name: "Steps",
      used: runtimeState?.steps_taken ?? 0,
      budget: (runtimeState?.steps_taken ?? 0) + (observation?.steps_remaining ?? 0),
    },
  ];

  const latest = metricsHistory[metricsHistory.length - 1] ?? {
    f1: 0,
    precision: 0,
    recall: 0,
    score: 0,
    mttr: 0,
  };

  return (
    <section className="panel-shell flex h-full flex-col">
      <div className="panel-header">
        <div>
          <p className="section-title">Metrics Panel</p>
          <p className="mt-1 text-sm text-cream/60">Projected judge metrics with live step-by-step transitions.</p>
        </div>
        <div className="rounded-full border border-healthy/20 bg-healthy/10 px-3 py-1 text-sm font-semibold text-healthy">
          Score {formatPercentage(grade?.score ?? latest.score)}
        </div>
      </div>

      <div className="grid flex-1 gap-4 p-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="metric-chart surface-card">
          <p className="soft-label">F1 + Precision / Recall</p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricsHistory}>
                <defs>
                  <linearGradient id="f1Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D8D1C2" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="#D8D1C2" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="step" tick={{ fill: "#F3E8DF", fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fill: "#F3E8DF", fontSize: 11 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="f1"
                  stroke="#D8D1C2"
                  fill="url(#f1Gradient)"
                  isAnimationActive
                  animationDuration={650}
                />
                <Area
                  type="monotone"
                  dataKey="precision"
                  stroke="#6E8E73"
                  fill="transparent"
                  isAnimationActive
                  animationDuration={650}
                />
                <Area
                  type="monotone"
                  dataKey="recall"
                  stroke="#C7904D"
                  fill="transparent"
                  isAnimationActive
                  animationDuration={650}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          <div className="metric-chart surface-card">
            <p className="soft-label">MTTR (steps)</p>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mttrData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#F3E8DF", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#F3E8DF", fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="budget" fill="#6E5D59" radius={[10, 10, 0, 0]} isAnimationActive animationDuration={650} />
                  <Bar dataKey="used" fill="#B45C64" radius={[10, 10, 0, 0]} isAnimationActive animationDuration={650} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "F1", value: latest.f1 },
              { label: "Precision", value: latest.precision },
              { label: "Recall", value: latest.recall },
              { label: "MTTR", value: latest.mttr, raw: true },
            ].map((card) => (
              <div key={card.label} className="stat-card min-w-0">
                <p className="soft-label whitespace-nowrap">{card.label}</p>
                <p className="mt-2 text-2xl font-bold text-cream">
                  {card.raw ? card.value : formatPercentage(card.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

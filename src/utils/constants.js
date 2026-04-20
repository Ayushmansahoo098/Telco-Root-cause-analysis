export const TASK_METADATA = {
  easy: {
    index: 1,
    title: "Alarm Containment",
    shortLabel: "Easy",
    operatorStory: "Identify and fix a single-site power failure in a small 20-node network. 5-10 alarms, zero noise. Perfect for initial agent calibration.",
    description: "A single power unit has failed in a small 5G network. Roughly 5-10 downstream alarms with NO noise. Your job: classify the alarm and suggest a standard repair within 15 steps.",
    accent: "from-healthy/30 via-sand/10 to-transparent",
  },
  medium: {
    index: 2,
    title: "Regional Cascade",
    shortLabel: "Medium",
    operatorStory: "Handle 10-50 simultaneous alarms with 20% noise in a 100-node cluster. Requires correlation to find the one true faulty node.",
    description: "A core switch or power unit has failed in a 100-node 5G network. You'll handle ~10-50 alarms with 20% noise. Diagnose root cause within 30 steps while minimizing false positives.",
    accent: "from-suspect/30 via-sand/10 to-transparent",
  },
  hard: {
    index: 3,
    title: "Systemic Outage",
    shortLabel: "Hard",
    operatorStory: "Deep knowledge graph navigation across 500 nodes with 40% noise. Heavy penalties for false positives during multi-region recovery.",
    description: "A cascading failure in a 500-node 5G Knowledge Graph with 40% noise. Navigate physical and logical dependencies across multiple regions to stop an outage within 50 steps.",
    accent: "from-failure/30 via-sand/10 to-transparent",
  },
  extreme: {
    index: 4,
    title: "Extreme Cascade",
    shortLabel: "Extreme",
    operatorStory: "The ultimate test: 1000 nodes, 8 regions, and 60% noise. Multi-hop reasoning required to filter convincing false incident clusters.",
    description: "A worst-case outage across a 1000-node, 8-region network with 60% noise. Failures originate across layers, requiring deep multi-hop reasoning to filter spurious clusters.",
    accent: "from-failure/18 via-bronze/6 to-transparent",
  },
};

export const ACTION_LABELS = {
  CHECK_LOGS: "Query Node",
  CHECK_VOLTAGE: "Check Voltage",
  TRACE_PATH: "Trace Path",
  RESTART: "Restart Node",
  DIAGNOSE: "Submit RCA",
};

export const ACTION_API_NAMES = {
  CHECK_LOGS: "query_node",
  CHECK_VOLTAGE: "check_voltage",
  TRACE_PATH: "trace_path",
  RESTART: "restart_node",
  DIAGNOSE: "submit_root_cause",
};

export const SEVERITY_WEIGHT = {
  MINOR: 0.32,
  WARNING: 0.56,
  MAJOR: 0.82,
  CRITICAL: 1,
};

export const STATUS_COLORS = {
  UP: "healthy",
  DEGRADED: "suspect",
  FAILED: "failure",
};

export const LAYER_CONFIG = {
  power_unit: {
    label: "Power Unit",
    shortLabel: "PWR",
    role: "Power Hub",
    tint: "#D7B79B",
  },
  core_switch: {
    label: "BBU",
    shortLabel: "BBU",
    role: "Backhaul Switch",
    tint: "#E8D1C5",
  },
  radio_controller: {
    label: "RRU",
    shortLabel: "RRU",
    role: "Radio Controller",
    tint: "#F2B950",
  },
  cell_tower: {
    label: "Antenna",
    shortLabel: "ANT",
    role: "Sector Endpoint",
    tint: "#F3E8DF",
  },
};

export const MANUAL_ACTIONS = [
  "CHECK_LOGS",
  "CHECK_VOLTAGE",
  "TRACE_PATH",
  "RESTART",
  "DIAGNOSE",
];

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EPISODES="${BASELINE_EPISODES:-3}"
TASKS="${BASELINE_TASKS:-easy,medium,hard,extreme}"
OUTPUT_FILE="${BASELINE_OUTPUT:-$ROOT_DIR/artifacts/baseline_report.txt}"
SERVER_URL="${SERVER_URL:-http://localhost:7860}"

usage() {
  cat <<'EOF'
Usage: ./run_baseline.sh [--episodes N] [--tasks easy,medium,hard,extreme] [--output PATH]

Runs the baseline agent N times on each selected difficulty and writes a
summary report with mean/std score plus MTTR (elapsed_seconds) statistics.

Environment variables:
  SERVER_URL         OpenEnv server URL (default: http://localhost:7860)
  BASELINE_EPISODES  Default number of episodes per task (default: 3)
  BASELINE_TASKS     Default task list (default: easy,medium,hard,extreme)
  BASELINE_OUTPUT    Default output report path
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--episodes)
      EPISODES="${2:-}"
      shift 2
      ;;
    -t|--tasks)
      TASKS="${2:-}"
      shift 2
      ;;
    -o|--output)
      OUTPUT_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$EPISODES" || ! "$EPISODES" =~ ^[0-9]+$ || "$EPISODES" -lt 1 ]]; then
  echo "ERROR: --episodes must be a positive integer." >&2
  exit 1
fi

TASKS="${TASKS// /}"
if [[ -z "$TASKS" ]]; then
  echo "ERROR: task list is empty." >&2
  exit 1
fi

if ! curl -fsS "${SERVER_URL%/}/health" >/dev/null; then
  echo "ERROR: Telco-RCA server is not healthy at ${SERVER_URL}." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
RESULTS_JSONL="$WORK_DIR/results.jsonl"
trap 'rm -rf "$WORK_DIR"' EXIT

touch "$RESULTS_JSONL"

task_base_seed() {
  case "$1" in
    easy) echo 42 ;;
    medium) echo 1042 ;;
    hard) echo 2042 ;;
    extreme) echo 3042 ;;
    *) echo 4042 ;;
  esac
}

echo "[INFO] Running baseline benchmark"
echo "[INFO] Server: $SERVER_URL"
echo "[INFO] Tasks: $TASKS"
echo "[INFO] Episodes per task: $EPISODES"

IFS=',' read -r -a TASK_LIST <<< "$TASKS"
for task in "${TASK_LIST[@]}"; do
  if [[ -z "$task" ]]; then
    continue
  fi

  base_seed="$(task_base_seed "$task")"
  for ((episode=1; episode<=EPISODES; episode++)); do
    seed=$((base_seed + episode - 1))
    log_file="$WORK_DIR/${task}_ep${episode}.log"

    echo "[RUN] task=$task episode=$episode/$EPISODES seed=$seed"

    if ! TASK_NAME="$task" EPISODE_SEED="$seed" SERVER_URL="$SERVER_URL" \
      python "$ROOT_DIR/inference.py" >"$log_file"; then
      echo "ERROR: inference failed for task=$task seed=$seed" >&2
      tail -n 40 "$log_file" >&2 || true
      exit 1
    fi

    python - "$log_file" "$task" "$seed" "$episode" "$RESULTS_JSONL" <<'PY'
import json
import pathlib
import sys

log_path = pathlib.Path(sys.argv[1])
task = sys.argv[2]
seed = int(sys.argv[3])
episode_index = int(sys.argv[4])
results_path = pathlib.Path(sys.argv[5])

end_line = None
for line in log_path.read_text(encoding="utf-8").splitlines():
    if line.startswith("[END] "):
        end_line = line

if end_line is None:
    raise SystemExit(f"missing [END] line in {log_path}")

payload = json.loads(end_line.split(" ", 1)[1])
episode_result = payload.get("results", [])
if not episode_result:
    raise SystemExit(f"missing episode result in {log_path}")

result = episode_result[-1]
record = {
    "task": task,
    "episode_index": episode_index,
    "seed": seed,
    "score": float(result.get("score", 0.001)),
    "mttr_seconds": float(result.get("elapsed_seconds", 0.0)),
    "steps_taken": int(result.get("steps_taken", 0)),
    "false_positives": int(result.get("false_positives", 0)),
    "root_cause_fixed": bool(result.get("root_cause_fixed", False)),
    "correct_diagnosis": bool(result.get("correct_diagnosis", False)),
    "breakdown": result.get("breakdown", {}),
}

with results_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\n")
PY
  done
done

python - "$RESULTS_JSONL" "$OUTPUT_FILE" "$SERVER_URL" "$EPISODES" "$TASKS" <<'PY'
import json
import pathlib
import statistics
import sys
from collections import defaultdict

results_path = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])
server_url = sys.argv[3]
episodes = int(sys.argv[4])
tasks = [task for task in sys.argv[5].split(",") if task]

records = []
for line in results_path.read_text(encoding="utf-8").splitlines():
    if line.strip():
      records.append(json.loads(line))

by_task = defaultdict(list)
for record in records:
    by_task[record["task"]].append(record)

def mean(values):
    return statistics.fmean(values) if values else 0.0

def std(values):
    return statistics.pstdev(values) if len(values) > 1 else 0.0

lines = []
lines.append("Telco-RCA Baseline Benchmark Report")
lines.append(f"Server: {server_url}")
lines.append(f"Episodes per task: {episodes}")
lines.append(f"Tasks: {', '.join(tasks)}")
lines.append("")
lines.append("Per-episode results")
lines.append("task       ep  seed  score   mttr_s  steps  fp  success")
lines.append("---------  --  ----  ------  ------  -----  --  -------")

task_index = {task: index for index, task in enumerate(tasks)}
for record in sorted(records, key=lambda item: (task_index.get(item["task"], 999), item["episode_index"])):
    success = "yes" if (record["root_cause_fixed"] or record["correct_diagnosis"]) else "no"
    lines.append(
        f"{record['task']:<9}  "
        f"{record['episode_index']:>2}  "
        f"{record['seed']:>4}  "
        f"{record['score']:>6.4f}  "
        f"{record['mttr_seconds']:>6.2f}  "
        f"{record['steps_taken']:>5}  "
        f"{record['false_positives']:>2}  "
        f"{success:>7}"
    )

lines.append("")
lines.append("Per-task summary")
lines.append("task       n   mean_score  std_score  mean_mttr_s  std_mttr_s  success_rate")
lines.append("---------  --  ----------  ---------  -----------  ----------  ------------")

for task in tasks:
    rows = by_task.get(task, [])
    scores = [row["score"] for row in rows]
    mttrs = [row["mttr_seconds"] for row in rows]
    successes = sum(1 for row in rows if row["root_cause_fixed"] or row["correct_diagnosis"])
    success_rate = f"{successes}/{len(rows)}" if rows else "0/0"
    lines.append(
        f"{task:<9}  "
        f"{len(rows):>2}  "
        f"{mean(scores):>10.4f}  "
        f"{std(scores):>9.4f}  "
        f"{mean(mttrs):>11.2f}  "
        f"{std(mttrs):>10.2f}  "
        f"{success_rate:>12}"
    )

all_scores = [row["score"] for row in records]
all_mttrs = [row["mttr_seconds"] for row in records]
all_successes = sum(1 for row in records if row["root_cause_fixed"] or row["correct_diagnosis"])
lines.append("")
lines.append("Overall")
lines.append(f"  runs: {len(records)}")
lines.append(f"  mean_score: {mean(all_scores):.4f}")
lines.append(f"  std_score: {std(all_scores):.4f}")
lines.append(f"  mean_mttr_s: {mean(all_mttrs):.2f}")
lines.append(f"  std_mttr_s: {std(all_mttrs):.2f}")
lines.append(f"  success_rate: {all_successes}/{len(records)}")
lines.append("")
lines.append("Notes:")
lines.append("  - MTTR is reported as elapsed_seconds from inference.py, matching the grader's speed input.")
lines.append("  - Scores are the environment-grade values in the [0.0, 1.0] range.")

report = "\n".join(lines) + "\n"
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(report, encoding="utf-8")
print(report, end="")
PY

echo "[DONE] Wrote report to $OUTPUT_FILE"

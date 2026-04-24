"""
Telco-RCA FastAPI server — implements the OpenEnv HTTP interface.

Endpoints:
    POST /reset    — Start a new episode for a given task
    POST /step     — Execute an agent action
    GET  /state    — Sanitized runtime state for UI/grading inputs
    GET  /trajectory — Structured trajectory data for visualization
    GET  /state/internal — Token-protected debug state with answer key
    GET  /tasks    — List all available tasks
    GET  /health   — Liveness check
    POST /grade    — Score a complete trajectory
"""

from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
import os
import time

from .environment import TelcoRCAEnvironment
from .models import AgentAction, TASK_CONFIGS
from .graders import grade_easy, grade_medium, grade_hard, grade_extreme, grade_episode

app = FastAPI(
    title="Telco-RCA OpenEnv",
    description=(
        "5G Network Root Cause Analysis — RL environment for fault diagnosis agents. "
        "Simulate cascading equipment failures across a layered telecom knowledge graph "
        "and train agents to identify the true root cause with minimum false positives."
    ),
    version="1.0.0",
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_PATH = STATIC_DIR / "index.html"


def _load_allowed_origins() -> list[str]:
    configured = os.getenv("ALLOWED_ORIGINS", "")
    if configured.strip():
        return [origin.strip() for origin in configured.split(",") if origin.strip()]

    defaults = [
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:7860",
        "http://127.0.0.1:7860",
    ]
    public_base_url = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    if public_base_url:
        defaults.append(public_base_url)
    return defaults


ALLOWED_ORIGINS = _load_allowed_origins()
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", r"https://.*\.hf\.space")
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")

app.state.startup_ready = False
app.state.startup_checks = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)

# Route for the main UI
@app.get("/")
def serve_ui():
    if INDEX_PATH.exists():
        return FileResponse(INDEX_PATH)
    return HTMLResponse(
        """
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Telco-RCA</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                background: #2a1114;
                color: #f3e8d7;
                font-family: ui-sans-serif, system-ui, sans-serif;
              }
              .card {
                max-width: 32rem;
                padding: 2rem;
                border: 1px solid rgba(243, 232, 215, 0.2);
                border-radius: 1.25rem;
                background: rgba(255, 255, 255, 0.05);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
              }
              h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
              p { margin: 0.5rem 0 0; line-height: 1.6; opacity: 0.9; }
              code { background: rgba(255,255,255,0.08); padding: 0.15rem 0.35rem; border-radius: 0.35rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Telco-RCA is starting</h1>
              <p>The UI assets are not available yet. Refresh in a moment, or check <code>/ready</code> for the boot status.</p>
            </div>
          </body>
        </html>
        """.strip(),
        status_code=200,
    )

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def _startup_check():
    checks = {
        "static_dir_exists": STATIC_DIR.exists(),
        "index_html_exists": INDEX_PATH.exists(),
        "task_registry_loaded": bool(TASK_CONFIGS),
    }
    app.state.startup_checks = checks
    app.state.startup_ready = all(checks.values())
    app.state.startup_started_at = time.time()

# One environment instance per task (stateful server)
_envs: dict[str, TelcoRCAEnvironment] = {}


def _get_env(task: str) -> TelcoRCAEnvironment:
    if task not in _envs:
        _envs[task] = TelcoRCAEnvironment(task_name=task)
    return _envs[task]


def _require_admin_token(x_admin_token: str | None):
    if not INTERNAL_API_TOKEN:
        raise HTTPException(404, "Internal state endpoint is disabled.")
    if x_admin_token != INTERNAL_API_TOKEN:
        raise HTTPException(401, "Invalid admin token.")


# ------------------------------------------------------------------ #
#  Request/response schemas                                            #
# ------------------------------------------------------------------ #

class ResetRequest(BaseModel):
    task: str = "easy"
    seed: int | None = None

class StepRequest(BaseModel):
    task: str
    action: AgentAction

class AgentStepRequest(BaseModel):
    task: str
    history: list[dict]

class GradeRequest(BaseModel):
    task: str
    trajectory: dict


# ------------------------------------------------------------------ #
#  Endpoints                                                           #
# ------------------------------------------------------------------ #

@app.get("/health")
def health():
    return {
        "status": "ok",
        "environment": "telco-rca",
        "version": "1.0.0",
        "ready": bool(getattr(app.state, "startup_ready", False)),
        "ui_assets_ready": INDEX_PATH.exists(),
        "tasks_available": list(TASK_CONFIGS.keys()),
    }


@app.get("/ready")
def ready():
    ready_state = bool(getattr(app.state, "startup_ready", False))
    started_at = float(getattr(app.state, "startup_started_at", time.time()))
    payload = {
        "status": "ready" if ready_state else "booting",
        "ready": ready_state,
        "environment": "telco-rca",
        "version": "1.0.0",
        "uptime_seconds": round(time.time() - started_at, 2),
        "checks": getattr(app.state, "startup_checks", {}),
        "tasks_available": list(TASK_CONFIGS.keys()),
    }
    return JSONResponse(status_code=200 if ready_state else 503, content=payload)


@app.get("/tasks")
def list_tasks():
    return {
        "tasks": [
            {
                "name": cfg.name,
                "description": cfg.description,
                "num_nodes": cfg.num_nodes,
                "max_steps": cfg.max_steps,
                "failure_layers": cfg.failure_layers,
                "noise_ratio": cfg.noise_ratio,
                "num_regions": cfg.num_regions,
            }
            for cfg in TASK_CONFIGS.values()
        ]
    }


@app.post("/reset")
async def reset(req: Optional[ResetRequest] = None, request: Request = None):
    if req is None:
        try:
            body = await request.json()
            req = ResetRequest(**body) if body else ResetRequest()
        except Exception:
            req = ResetRequest()
    if req.task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{req.task}'. Valid: {list(TASK_CONFIGS)}")
    env = _get_env(req.task)
    obs = env.reset(seed=req.seed)
    return obs.model_dump()


@app.post("/step")
def step(req: StepRequest):
    if req.task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{req.task}'.")
    env = _get_env(req.task)
    try:
        result = env.step(req.action)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return result.model_dump()


@app.post("/agent/step")
def agent_step(req: AgentStepRequest):
    if req.task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{req.task}'.")
    env = _get_env(req.task)
    if env._state is None:
        raise HTTPException(400, "Environment not initialized.")
    obs = env._build_observation().model_dump()
    try:
        import sys
        import os
        sys.path.append(os.getcwd())
        from inference import llm_decide
        action = llm_decide(obs, req.history)
        return action
    except Exception as e:
        raise HTTPException(500, f"Failed to run LLM agent: {str(e)}")


@app.get("/state")
def state(task: str = "easy"):
    if task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{task}'.")
    return _get_env(task).state()


@app.get("/trajectory")
def trajectory(task: str = "easy"):
    if task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{task}'.")
    return _get_env(task).trajectory()


@app.get("/state/internal")
def internal_state(task: str = "easy", x_admin_token: str | None = Header(default=None, alias="X-Admin-Token")):
    if task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{task}'.")
    _require_admin_token(x_admin_token)
    return _get_env(task).state(include_answer_key=True)


@app.post("/grade")
def grade(req: GradeRequest):
    if req.task not in TASK_CONFIGS:
        raise HTTPException(400, f"Unknown task '{req.task}'.")

    # Use the detailed grader with intelligence signals
    result = grade_episode(
        task_name=req.task,
        root_cause_fixed=req.trajectory.get("root_cause_fixed", False),
        steps_taken=req.trajectory.get("steps_taken", TASK_CONFIGS[req.task].max_steps),
        false_positives=req.trajectory.get("false_positives", 0),
        elapsed_seconds=req.trajectory.get("elapsed_seconds", 300),
        correct_diagnosis=req.trajectory.get("correct_diagnosis", False),
        checked_nodes=req.trajectory.get("checked_nodes"),
        checked_layers=req.trajectory.get("checked_layers"),
        total_nodes=req.trajectory.get("total_nodes", 0),
        total_layers_alarming=req.trajectory.get("total_layers_alarming", 0),
        action_log=req.trajectory.get("action_log"),
    )
    return {
        "task": req.task,
        "score": result["score"],
        "reason": result["reason"],
        "breakdown": result["breakdown"],
    }


def start():
    """Entry point for `openenv serve` / pyproject.toml scripts."""
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=7860)
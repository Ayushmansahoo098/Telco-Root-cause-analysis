"""
server/app.py — OpenEnv convention entry point.
Re-exports the FastAPI app and provides a main() entry point.
"""

import uvicorn
from app.main import app  # noqa: F401


def main():
    """Start the Telco-RCA server."""
    uvicorn.run("app.main:app", host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()

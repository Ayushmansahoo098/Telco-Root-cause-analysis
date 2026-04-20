"""
Telco-RCA: 5G Network Root Cause Analysis Environment
=====================================================

An OpenEnv-compatible RL environment where AI agents diagnose cascading
equipment failures in simulated 5G networks. The agent must trace alarm
cascades through a layered knowledge graph to identify the single root
cause node responsible for hundreds of downstream symptom alarms.

Difficulty tiers:
  easy   — 20 nodes, single power unit failure, no noise
  medium — 100 nodes, switch/power failure, 20 % noise
  hard   — 500 nodes, any-layer failure, 40 % noise
  extreme — 1000 nodes, multi-region failure, 60 % noise
"""

__version__ = "1.0.0"

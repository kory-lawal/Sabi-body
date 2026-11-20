"""Realtime delivery over one authenticated WebSocket per browser tab.

Postgres is always the source of truth; the in-memory registry below only
knows who is connected *to this process* so events can be pushed to them.
SabiBody's backend runs as a single Render instance, so one registry suffices.
"""

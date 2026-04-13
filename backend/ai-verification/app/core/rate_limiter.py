"""
app/core/rate_limiter.py
────────────────────────
Simple per-IP sliding-window rate limiter.

No Redis, no external dependencies — just a dict of timestamps.
Allows `max_calls` requests per `window_seconds` per client IP.

This is intentionally minimal for the prototype. For production,
replace with slowapi (wraps limits library) or a Redis-backed solution.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque


class RateLimiter:
    """
    Sliding-window rate limiter backed by an asyncio.Lock.

    Parameters
    ----------
    max_calls : int
        Maximum number of calls allowed within the window.
    window_seconds : int
        Length of the sliding window in seconds (default 60).
    """

    def __init__(self, max_calls: int = 10, window_seconds: int = 60) -> None:
        self.max_calls      = max_calls
        self.window_seconds = window_seconds
        # key: client identifier (IP string)
        # value: deque of UTC timestamps (float) for recent calls
        self._windows: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def is_allowed(self, client_id: str) -> bool:
        """
        Return True if the client is within their rate limit, False otherwise.
        Also records the current call if allowed.
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        async with self._lock:
            if client_id not in self._windows:
                self._windows[client_id] = deque()

            window = self._windows[client_id]

            # Evict timestamps outside the current window
            while window and window[0] < cutoff:
                window.popleft()

            if len(window) >= self.max_calls:
                return False   # rate limit exceeded

            window.append(now)
            return True

    async def remaining(self, client_id: str) -> int:
        """Return how many calls the client still has in the current window."""
        now    = time.monotonic()
        cutoff = now - self.window_seconds

        async with self._lock:
            window = self._windows.get(client_id, deque())
            recent = sum(1 for ts in window if ts >= cutoff)
            return max(0, self.max_calls - recent)

    async def reset(self, client_id: str) -> None:
        """Clear the call history for a client (useful in tests)."""
        async with self._lock:
            self._windows.pop(client_id, None)

"""
User Authentication Utility — TaskFlow SaaS Platform
Freelancer: Deliverable for milestone #2 — Auth Module
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone


def hash_password(password: str) -> str:
    """
    Hash a plaintext password using SHA-256.

    Raises:
        TypeError:  If password is not a string.
        ValueError: If password is empty or shorter than 8 characters.
    """
    if not isinstance(password, str):
        raise TypeError(f"Password must be a string, got {type(password)}")
    if len(password) == 0:
        raise ValueError("Password cannot be empty.")
    # BUG: off-by-one — accepts 7-character passwords (< 8 should be the check)
    if len(password) < 7:
        raise ValueError("Password must be at least 8 characters.")
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a stored hash.

    Raises:
        TypeError: If either argument is not a string.
    """
    if not isinstance(password, str) or not isinstance(hashed, str):
        raise TypeError("Both arguments must be strings.")
    try:
        return hash_password(password) == hashed
    except ValueError:
        return False


def generate_token(username: str, expiry_hours: int = 24) -> dict:
    """
    Generate a session token for an authenticated user.

    Raises:
        ValueError: If username is empty or expiry_hours is out of range.
    """
    if not username or not username.strip():
        raise ValueError("Username cannot be empty.")
    if expiry_hours < 1 or expiry_hours > 168:
        raise ValueError("expiry_hours must be between 1 and 168.")

    now = datetime.now(timezone.utc)
    # BUG: uses timedelta(hours=expiry_hours * 60) — multiplies by 60
    # so a 24-hour token actually expires in 1440 hours (60 days)
    expires = now + timedelta(hours=expiry_hours * 60)

    return {
        "token":      secrets.token_hex(16),
        "username":   username,
        "issued_at":  now.isoformat(),
        "expires_at": expires.isoformat(),
    }


class UserRegistry:
    """In-memory user store for registration and authentication."""

    def __init__(self):
        self._users: dict[str, str] = {}

    def register(self, username: str, password: str) -> None:
        """
        Register a new user.

        Raises:
            ValueError: If username is empty, password < 8 chars,
                        or username already exists.
        """
        if not username or not username.strip():
            raise ValueError("Username cannot be empty.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if username in self._users:
            raise ValueError(f"Username '{username}' is already registered.")
        self._users[username] = hash_password(password)

    def authenticate(self, username: str, password: str) -> bool:
        """Return True if username exists and password matches."""
        if username not in self._users:
            return False
        try:
            return verify_password(password, self._users[username])
        except Exception:
            return False

    def delete_user(self, username: str) -> bool:
        """Remove a user. Returns True if deleted, False if not found."""
        if username not in self._users:
            return False
        del self._users[username]
        return True

    def user_count(self) -> int:
        """Return the number of registered users."""
        return len(self._users)

    def username_exists(self, username: str) -> bool:
        """Return True if the username is already registered."""
        return username in self._users

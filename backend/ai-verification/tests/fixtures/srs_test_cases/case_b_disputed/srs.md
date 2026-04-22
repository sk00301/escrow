# Software Requirements Specification (SRS)
# Project: User Authentication Utility
# Client: TaskFlow SaaS Platform
# Version: 1.0

## 1. Project Overview

**Project Name:** User Authentication Utility
**Module/File:** submission.py
**Language:** Python 3.x
**Description:**
A backend authentication utility for the TaskFlow SaaS platform.
Handles password hashing, validation, token generation, and a simple
in-memory user registry. This module is the security foundation —
every requirement is a security requirement.

---

## 2. Functions Required

### Function: `hash_password(password: str) -> str`

**Purpose:**
Hash a plaintext password using SHA-256. Returns a hex digest string.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| password | str | Plaintext password to hash |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If password is empty string |
| ValueError | If password is shorter than 8 characters |
| TypeError | If password is not a string |

**Returns:**
| Type | Description |
|------|-------------|
| str | 64-character lowercase hex string (SHA-256 digest) |

**Examples:**
```python
h = hash_password("securePass1")
assert len(h) == 64
assert h == hash_password("securePass1")   # deterministic
assert h != hash_password("differentPass") # different input = different hash
```

---

### Function: `verify_password(password: str, hashed: str) -> bool`

**Purpose:**
Verify a plaintext password against a stored hash.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| password | str | Plaintext password to check |
| hashed | str | Previously stored hash to compare against |

**Returns:**
| Type | Description |
|------|-------------|
| bool | True if password matches hash, False otherwise |

**Raises:**
| Exception | When |
|-----------|------|
| TypeError | If either argument is not a string |

**Examples:**
```python
h = hash_password("myPassword1")
verify_password("myPassword1", h)   # → True
verify_password("wrongPass99", h)   # → False
```

---

### Function: `generate_token(username: str, expiry_hours: int = 24) -> dict`

**Purpose:**
Generate a simple session token for an authenticated user.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| username | str | The authenticated user's username |
| expiry_hours | int | How many hours until the token expires, must be 1–168 (1 week max) |

**Returns:**
```python
{
    "token":      str,   # 32-character random hex string
    "username":   str,
    "expires_at": str,   # ISO 8601 datetime string
    "issued_at":  str,   # ISO 8601 datetime string
}
```

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If username is empty |
| ValueError | If expiry_hours < 1 or > 168 |

---

### Class: `UserRegistry`

**Purpose:**
In-memory registry for storing and authenticating users.

**Constructor: `__init__(self)`**
- Initialises with an empty user store

**Methods:**

| Method | Signature | Returns | Raises |
|--------|-----------|---------|--------|
| register | `register(self, username: str, password: str) -> None` | None | ValueError if username exists, ValueError if password < 8 chars, ValueError if username empty |
| authenticate | `authenticate(self, username: str, password: str) -> bool` | bool | — (returns False for unknown users) |
| delete_user | `delete_user(self, username: str) -> bool` | bool (True if deleted, False if not found) | — |
| user_count | `user_count(self) -> int` | int | — |
| username_exists | `username_exists(self, username: str) -> bool` | bool | — |

---

## 4. Acceptance Criteria

- MUST reject passwords shorter than 8 characters
- MUST reject empty username
- MUST raise ValueError when registering a duplicate username
- `authenticate()` MUST return False for unknown users (not raise)
- `authenticate()` MUST return False for wrong password (not raise)
- Token MUST contain a 32-character hex token string
- Token expiry MUST be exactly expiry_hours from issued_at
- `delete_user()` MUST return False (not raise) for unknown users
- Hashing MUST be deterministic — same input always gives same hash
- `verify_password()` comparison MUST be case-sensitive

---

## 5. Boundary Values

| Input | Expected | Notes |
|-------|----------|-------|
| password = "abc" (7 chars) | raises ValueError | Below minimum length |
| password = "abcdefgh" (8 chars) | accepted | Minimum valid length |
| expiry_hours = 0 | raises ValueError | Below minimum |
| expiry_hours = 168 | valid token | Maximum allowed |
| expiry_hours = 169 | raises ValueError | Above maximum |
| username = "" | raises ValueError | Empty not allowed |
| duplicate register | raises ValueError | Must check for existing |

---

## 7. Sample Input / Output

```python
# Registration and authentication
registry = UserRegistry()
registry.register("alice", "password123")
assert registry.user_count() == 1
assert registry.username_exists("alice") is True
assert registry.authenticate("alice", "password123") is True
assert registry.authenticate("alice", "wrongpassword") is False
assert registry.authenticate("unknown", "anything") is False

# Duplicate registration
try:
    registry.register("alice", "anotherpass")
    assert False, "Should have raised"
except ValueError:
    pass

# Token generation
token_data = generate_token("alice", expiry_hours=2)
assert len(token_data["token"]) == 32
assert token_data["username"] == "alice"
```

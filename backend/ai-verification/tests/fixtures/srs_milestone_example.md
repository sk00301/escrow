# Software Requirements Specification (SRS)

## 1. Project Overview

**Project Name:** Calculator Module
**Module/File:** calculator.py
**Language:** Python 3.x
**Description:**
A basic arithmetic calculator module implementing six operations with full
input validation, zero-division protection, and docstrings on every function.

---

## 2. Functions / Classes Required

### Function: `add(a, b)`

**Purpose:** Return the sum of a and b.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| a | float | First operand |
| b | float | Second operand |

**Returns:**
| Type | Description |
|------|-------------|
| float | a + b |

**Examples:**
```python
add(3, 4)    # → 7
add(-1, 1)   # → 0
add(0, 0)    # → 0
```

---

### Function: `subtract(a, b)`

**Purpose:** Return the difference a minus b.

**Examples:**
```python
subtract(10, 3)  # → 7
subtract(0, 5)   # → -5
```

---

### Function: `multiply(a, b)`

**Purpose:** Return the product of a and b.

**Examples:**
```python
multiply(3, 4)    # → 12
multiply(-2, 5)   # → -10
multiply(0, 100)  # → 0
```

---

### Function: `divide(a, b)`

**Purpose:** Return a divided by b. Raises ValueError when b is zero.

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | when b == 0 |

**Examples:**
```python
divide(10, 2)   # → 5.0
divide(7, 0)    # → raises ValueError("Division by zero")
```

---

### Function: `power(base, exp)`

**Purpose:** Return base raised to the power exp.

**Examples:**
```python
power(2, 10)  # → 1024
power(5, 0)   # → 1
power(2, -1)  # → 0.5
```

---

### Function: `modulo(a, b)`

**Purpose:** Return a modulo b. Raises ValueError when b is zero.

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | when b == 0 |

**Examples:**
```python
modulo(10, 3)  # → 1
modulo(10, 0)  # → raises ValueError
```

---

## 3. Acceptance Criteria

- MUST implement all six functions: add, subtract, multiply, divide, power, modulo
- MUST raise ValueError (not ZeroDivisionError) when divisor is zero in divide()
- MUST raise ValueError when divisor is zero in modulo()
- MUST have docstrings on every function
- MUST NOT allow negative balances or unexpected exceptions

---

## 4. Boundary Values

| Input | Expected Output | Notes |
|-------|----------------|-------|
| divide(10, 0) | raises ValueError | exact exception type required |
| modulo(10, 0) | raises ValueError | exact exception type required |
| power(2, 0) | 1 | edge case |
| add(0, 0) | 0 | zero identity |

---

## 5. Non-Functional Requirements

- All functions must have docstrings
- Input validation at function entry
- No global state

---

## 6. Sample Input / Output

```python
assert add(1, 2) == 3
assert subtract(5, 3) == 2
assert multiply(4, 5) == 20
assert divide(10, 2) == 5.0
assert power(2, 8) == 256
assert modulo(10, 3) == 1
```

---

## 7. Diagrams / Screenshots (optional)

<!-- None for this project -->

---

## 8. Diagrams / Screenshots (optional)

<!-- None for this project -->

---

## 9. Milestone Deliverables

<!--
  Each ### block defines one milestone. The AI verifier reads only the block
  matching the submitted milestone number and ignores features not yet due.
-->

### Milestone 1 — Core scaffold
**Due:** 2026-07-01
**Required functions:** add, subtract
**Required keywords:** basic arithmetic, input validation
**Test scope:** pytest tests/unit/m1/
**Acceptance criteria:** Implement add(a, b) returning a+b and subtract(a, b) returning a-b. Both functions must have docstrings and accept any numeric input including negatives and zero. No validation beyond standard Python type coercion is required at this stage.

---

### Milestone 2 — Multiplication and division
**Due:** 2026-07-15
**Required functions:** multiply, divide
**Required keywords:** zero division, ValueError
**Test scope:** pytest tests/unit/m2/
**Acceptance criteria:** Implement multiply(a, b) returning a*b and divide(a, b) returning a/b. divide() MUST raise ValueError (not ZeroDivisionError or any other exception) when b is zero. All functions must have docstrings.
**Weight test:** 0.70
**Weight pylint:** 0.20
**Weight flake8:** 0.10

---

### Milestone 3 — Final delivery
**Due:** 2026-08-01
**Required functions:** add, subtract, multiply, divide, power, modulo
**Required keywords:** basic arithmetic, input validation, zero division, ValueError, docstrings
**Test scope:** pytest tests/
**Acceptance criteria:** Implement all six functions: add, subtract, multiply, divide, power, modulo. divide() and modulo() must raise ValueError when the divisor is zero. All functions must have docstrings. No ZeroDivisionError should ever escape to the caller.

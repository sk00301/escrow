# Software Requirements Specification (SRS)
<!-- 
  TEMPLATE INSTRUCTIONS
  ─────────────────────
  Fill in every section. The Test Generation Agent reads this document
  and uses it to write pytest tests for your submission.
  
  Rules for good SRS documents:
  - Be specific: "raises ValueError" not "handles errors"
  - Include exact boundary values: "score >= 90" not "high score"
  - List every function with its signature
  - Describe what SHOULD happen AND what SHOULD NOT happen
  - Include edge cases explicitly — the agent tests what you describe
-->

## 1. Project Overview

**Project Name:** <!-- e.g. Student Grade Calculator -->
**Module/File:** <!-- e.g. grade_calculator.py -->
**Language:** Python 3.x
**Description:**
<!-- 1-3 sentences describing what this module does -->


---

## 2. Functions / Classes Required

<!--
  For each function or class, fill in a block like below.
  Copy the block as many times as needed.
-->

### Function: `function_name(param1, param2, ...)`

**Purpose:**
<!-- What does this function do? One sentence. -->

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| param1 | type | description |
| param2 | type | description |

**Returns:**
| Type | Description |
|------|-------------|
| type | what it returns |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | when param1 is negative |
| TypeError  | when param1 is not a number |

**Examples:**
```python
function_name(3, 4)   # → 7
function_name(0, 5)   # → 5
function_name(-1, 5)  # → raises ValueError
```

**Edge Cases:**
- <!-- e.g. Returns 0 when both inputs are 0 -->
- <!-- e.g. Works correctly with float inputs -->
- <!-- e.g. Raises ValueError for empty string input -->

---
<!-- Repeat the block above for each function -->

---

## 3. Classes (if applicable)

### Class: `ClassName`

**Purpose:**
<!-- What does this class represent? -->

**Constructor: `__init__(self, param1, param2=default)`**
- param1: description, must be positive
- param2: optional, defaults to 0

**Methods:**

| Method | Signature | Returns | Raises |
|--------|-----------|---------|--------|
| method_one | `method_one(self, x)` | float | ValueError if x < 0 |
| method_two | `method_two(self)` | list | — |

**Invariants (always true):**
- <!-- e.g. balance is always >= 0 after any operation -->
- <!-- e.g. list returned by to_list() always has length == self.length() -->

---

## 4. Acceptance Criteria

<!--
  List the MUST-HAVE requirements. Each item becomes at least one test.
  Use MUST/MUST NOT language.
-->

- MUST implement `function_name` that returns correct results for valid inputs
- MUST raise `ValueError` (not `ZeroDivisionError`) when divisor is zero
- MUST raise `ValueError` for inputs outside valid range
- MUST NOT allow negative balances
- MUST track all transactions and return correct count
- MUST handle empty collections without raising unexpected errors

---

## 5. Boundary Values

<!--
  List the exact boundary values that must be tested.
  These are the most common source of bugs.
-->

| Input | Expected Output | Notes |
|-------|----------------|-------|
| score = 90 | "A" | Exact boundary — must return A not B |
| score = 89 | "B" | Just below A boundary |
| score = 0 | "F" | Minimum valid input |
| score = 100 | "A+" | Maximum valid input |
| score = -1 | raises ValueError | Below minimum |
| score = 101 | raises ValueError | Above maximum |

---

## 6. Non-Functional Requirements

- All functions must have docstrings
- Input validation must happen at the start of each function
- No global state — functions must be pure where possible
- Performance: all operations O(n) or better

---

## 7. Sample Input / Output

<!--
  Provide a few end-to-end examples showing full usage.
  The agent uses these to generate integration-style tests.
-->

```python
# Example 1: Happy path
calc = Calculator()
result = calc.divide(10, 2)
assert result == 5.0

# Example 2: Error case
try:
    calc.divide(10, 0)
    assert False, "Should have raised"
except ValueError as e:
    assert "zero" in str(e).lower()

# Example 3: Edge case
assert calc.add(0, 0) == 0
assert calc.multiply(1000000, 1000000) == 1_000_000_000_000
```

---

## 8. Diagrams / Screenshots (optional)

<!--
  If your SRS includes architecture diagrams, flowcharts, or UI mockups,
  attach them as images. The agent can read images if the model supports vision.
  
  Supported formats: PNG, JPG, PDF pages (converted to images)
  
  Example:
  ![Architecture Diagram](./diagrams/architecture.png)
  ![Flow Chart](./diagrams/flow.png)
-->

---

## 9. Milestone Deliverables

<!--
  REQUIRED when the project uses phased milestones.
  Fill in one block per milestone. The AI verifier reads this section to
  determine what to check at each submission — it will NOT penalise missing
  features that are scheduled for a later milestone.

  Rules:
  - "Required functions" and "Required keywords" are comma-separated lists.
  - "Test scope" must be a valid pytest command (or comma-separated list of them).
  - "Acceptance criteria" is the plain-English spec the LLM evaluates against.
    Keep it specific — "raises ValueError" not "handles errors".
  - Weight fields (optional) must be decimals summing to 1.0. Omit to use
    server defaults (test: 0.60, pylint: 0.25, flake8: 0.15 for code;
    similarity: 0.50, keywords: 0.35, structure: 0.15 for documents).
  - Copy the block below for each additional milestone.
-->

### Milestone 1 — <!-- short title, e.g. "Core scaffold" -->
**Due:** <!-- YYYY-MM-DD -->
**Required functions:** <!-- e.g. add, subtract -->
**Required keywords:** <!-- e.g. input validation, basic arithmetic -->
**Test scope:** <!-- e.g. pytest tests/unit/m1/ -->
**Acceptance criteria:** <!-- milestone-specific description of what must work -->

---
<!-- Repeat the block above for each milestone -->

### Milestone 2 — <!-- short title, e.g. "Advanced operations" -->
**Due:** <!-- YYYY-MM-DD -->
**Required functions:** <!-- e.g. multiply, divide -->
**Required keywords:** <!-- e.g. zero division, edge cases -->
**Test scope:** <!-- e.g. pytest tests/unit/m2/ -->
**Acceptance criteria:** <!-- milestone-specific description -->

---

### Milestone 3 — Final delivery
**Due:** <!-- YYYY-MM-DD -->
**Required functions:** <!-- all functions from sections 2 & 3 -->
**Required keywords:** <!-- all keywords from sections 4 & 5 -->
**Test scope:** pytest tests/
**Acceptance criteria:** <!-- full SRS acceptance criteria — copy from section 4 -->

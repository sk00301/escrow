"""
tests/fixtures/sample_submissions/calculator/src/calculator.py
══════════════════════════════════════════════════════════════════════════════
Demo submission used during B.Tech project presentation.

This module implements a basic calculator with intentional quality variations
so the verification engine can be demonstrated live:

  HIGH QUALITY scenario  → run against tests/  (all 10 tests pass)
  MEDIUM QUALITY scenario → run against tests/unit/ only (7/10 pass)
  LOW QUALITY scenario    → comment out the divide() fix and rerun

Simulated on-chain context
  Milestone:   "Implement a Python calculator with full arithmetic operations"
  Acceptance:  "All arithmetic operations tested, edge cases covered,
                division by zero handled, code quality ≥ 7/10"
"""

from __future__ import annotations


class CalculatorError(Exception):
    """Base exception for calculator domain errors."""


class DivisionByZeroError(CalculatorError):
    """Raised when a division by zero is attempted."""


def add(a: float, b: float) -> float:
    """Return the sum of a and b."""
    return a + b


def subtract(a: float, b: float) -> float:
    """Return a minus b."""
    return a - b


def multiply(a: float, b: float) -> float:
    """Return a multiplied by b."""
    return a * b


def divide(a: float, b: float) -> float:
    """
    Return a divided by b.

    Raises
    ------
    DivisionByZeroError
        If b is zero.
    """
    if b == 0:
        raise DivisionByZeroError(
            f"Cannot divide {a} by zero. Please provide a non-zero divisor."
        )
    return a / b


def power(base: float, exp: float) -> float:
    """Return base raised to the power of exp."""
    return base ** exp


def square_root(n: float) -> float:
    """
    Return the square root of n.

    Raises
    ------
    ValueError
        If n is negative (complex results not supported).
    """
    if n < 0:
        raise ValueError(
            f"Cannot compute square root of negative number {n}."
        )
    return n ** 0.5


def modulo(a: float, b: float) -> float:
    """
    Return the remainder of a divided by b.

    Raises
    ------
    DivisionByZeroError
        If b is zero.
    """
    if b == 0:
        raise DivisionByZeroError("Modulo by zero is undefined.")
    return a % b


def absolute(n: float) -> float:
    """Return the absolute value of n."""
    return abs(n)

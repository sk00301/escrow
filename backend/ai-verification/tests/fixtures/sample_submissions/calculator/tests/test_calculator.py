"""
tests/fixtures/sample_submissions/calculator/tests/test_calculator.py
══════════════════════════════════════════════════════════════════════════════
Milestone acceptance test suite for the calculator submission.

This is the test file that the AI Verification Engine runs inside the Docker
sandbox (or locally via subprocess) to evaluate the freelancer's submission.

Test coverage
─────────────
  Basic operations    add, subtract, multiply, divide
  Advanced operations power, square_root, modulo, absolute
  Edge cases          division by zero, negative sqrt, modulo by zero
  Type safety         float inputs, negative numbers, large numbers

Expected outcome when run against the COMPLETE submission
  10 tests, 10 passed, pass_rate = 1.0
  pylint score ≈ 9.0/10
  flake8 violations = 0
  → FINAL SCORE ≈ 0.975 → VERDICT: APPROVED
"""

import math

import pytest

from src.calculator import (
    DivisionByZeroError,
    absolute,
    add,
    divide,
    modulo,
    multiply,
    power,
    square_root,
    subtract,
)


# ── Basic operations ──────────────────────────────────────────────────────────

class TestAdd:
    def test_positive_integers(self):
        assert add(2, 3) == 5

    def test_negative_numbers(self):
        assert add(-4, 6) == 2

    def test_floats(self):
        assert add(1.5, 2.5) == pytest.approx(4.0)

    def test_zero_identity(self):
        assert add(7, 0) == 7


class TestSubtract:
    def test_basic(self):
        assert subtract(10, 3) == 7

    def test_result_negative(self):
        assert subtract(3, 10) == -7

    def test_floats(self):
        assert subtract(5.5, 2.2) == pytest.approx(3.3)


class TestMultiply:
    def test_positive(self):
        assert multiply(3, 4) == 12

    def test_by_zero(self):
        assert multiply(999, 0) == 0

    def test_negative(self):
        assert multiply(-3, 4) == -12

    def test_floats(self):
        assert multiply(2.5, 4.0) == pytest.approx(10.0)


class TestDivide:
    def test_exact_division(self):
        assert divide(10, 2) == 5.0

    def test_float_result(self):
        assert divide(7, 2) == pytest.approx(3.5)

    def test_division_by_zero_raises(self):
        with pytest.raises(DivisionByZeroError):
            divide(5, 0)

    def test_division_by_zero_message(self):
        with pytest.raises(DivisionByZeroError, match="Cannot divide"):
            divide(42, 0)

    def test_negative_dividend(self):
        assert divide(-9, 3) == -3.0


# ── Advanced operations ───────────────────────────────────────────────────────

class TestPower:
    def test_square(self):
        assert power(3, 2) == 9.0

    def test_zero_exponent(self):
        assert power(100, 0) == 1.0

    def test_fractional_exponent(self):
        assert power(4, 0.5) == pytest.approx(2.0)

    def test_negative_base(self):
        assert power(-2, 3) == -8.0


class TestSquareRoot:
    def test_perfect_square(self):
        assert square_root(9) == pytest.approx(3.0)

    def test_non_perfect_square(self):
        assert square_root(2) == pytest.approx(math.sqrt(2))

    def test_zero(self):
        assert square_root(0) == 0.0

    def test_negative_raises(self):
        with pytest.raises(ValueError, match="negative"):
            square_root(-4)


class TestModulo:
    def test_basic(self):
        assert modulo(10, 3) == 1

    def test_exact_division(self):
        assert modulo(9, 3) == 0

    def test_modulo_by_zero_raises(self):
        with pytest.raises(DivisionByZeroError):
            modulo(5, 0)

    def test_float_modulo(self):
        assert modulo(7.5, 2.5) == pytest.approx(0.0)


class TestAbsolute:
    def test_positive(self):
        assert absolute(5) == 5

    def test_negative(self):
        assert absolute(-7) == 7

    def test_zero(self):
        assert absolute(0) == 0

    def test_float(self):
        assert absolute(-3.14) == pytest.approx(3.14)

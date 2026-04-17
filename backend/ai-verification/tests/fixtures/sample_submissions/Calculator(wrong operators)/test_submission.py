import pytest
from submission import add, subtract, multiply, divide, power, modulo


def test_add_positive():
    assert add(3, 4) == 7             # PASSES

def test_add_negative():
    assert add(-1, -2) == -3          # PASSES

def test_add_mixed():
    assert add(-5, 5) == 0            # PASSES

def test_subtract_basic():
    assert subtract(10, 4) == 6       # PASSES

def test_subtract_negative_result():
    assert subtract(2, 9) == -7       # PASSES

def test_multiply_positive():
    assert multiply(3, 5) == 15       # FAILS — returns 8

def test_multiply_zero():
    assert multiply(7, 0) == 0        # FAILS — returns 7

def test_divide_basic():
    assert divide(10, 2) == 5.0       # FAILS — returns 0.2

def test_divide_float():
    assert abs(divide(1, 3) - 0.3333) < 0.001  # FAILS — returns 3.0

def test_divide_by_zero_raises():
    with pytest.raises(ValueError):   # FAILS — raises ZeroDivisionError not ValueError
        divide(5, 0)
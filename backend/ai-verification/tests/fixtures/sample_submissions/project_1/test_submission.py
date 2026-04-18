import pytest
from submission import add, subtract, multiply, divide, power, modulo


def test_add_positive():
    assert add(3, 4) == 7

def test_add_negative():
    assert add(-1, -2) == -3

def test_add_mixed():
    assert add(-5, 5) == 0

def test_subtract_basic():
    assert subtract(10, 4) == 6

def test_subtract_negative_result():
    assert subtract(2, 9) == -7

def test_multiply_positive():
    assert multiply(3, 5) == 15

def test_multiply_zero():
    assert multiply(7, 0) == 0

def test_divide_basic():
    assert divide(10, 2) == 5.0

def test_divide_float():
    assert abs(divide(1, 3) - 0.3333) < 0.001

def test_divide_by_zero_raises():
    with pytest.raises(ValueError):
        divide(5, 0)
import pytest
from submission import (
    celsius_to_fahrenheit, fahrenheit_to_celsius,
    celsius_to_kelvin, kelvin_to_celsius, fahrenheit_to_kelvin,
)


def test_boiling_point():
    assert celsius_to_fahrenheit(100) == 212.0      # FAILS — returns 87.6

def test_freezing_point():
    assert celsius_to_fahrenheit(0) == 32.0         # PASSES (accidentally)

def test_body_temperature():
    assert abs(celsius_to_fahrenheit(37) - 98.6) < 0.01  # FAILS

def test_f_to_c_freezing():
    assert fahrenheit_to_celsius(32) == 0.0         # FAILS — returns 115.2

def test_absolute_zero_kelvin():
    assert abs(celsius_to_kelvin(-273.15)) < 0.001  # FAILS — returns -546.3

def test_kelvin_to_celsius():
    assert abs(kelvin_to_celsius(373.15) - 100.0) < 0.001  # PASSES

def test_below_absolute_zero_raises():
    with pytest.raises(ValueError):
        celsius_to_fahrenheit(-300)                 # FAILS — no guard

def test_negative_kelvin_raises():
    with pytest.raises(ValueError):
        kelvin_to_celsius(-1)                       # FAILS — no guard

def test_f_to_kelvin():
    assert abs(fahrenheit_to_kelvin(212) - 373.15) < 0.01  # FAILS

def test_room_temperature():
    assert abs(celsius_to_fahrenheit(20) - 68.0) < 0.01    # FAILS
"""Temperature converter between Celsius, Fahrenheit, and Kelvin."""

ABSOLUTE_ZERO_C = -273.15


def celsius_to_fahrenheit(c):
    """Convert Celsius to Fahrenheit.

    Raises:
        ValueError: If temperature is below absolute zero.
    """
    if c < ABSOLUTE_ZERO_C:
        raise ValueError(f"Temperature {c}°C is below absolute zero.")
    return (c * 9 / 5) + 32


def fahrenheit_to_celsius(f):
    """Convert Fahrenheit to Celsius.

    Raises:
        ValueError: If temperature is below absolute zero in Fahrenheit.
    """
    c = (f - 32) * 5 / 9
    if c < ABSOLUTE_ZERO_C:
        raise ValueError(f"Temperature {f}°F is below absolute zero.")
    return c


def celsius_to_kelvin(c):
    """Convert Celsius to Kelvin.

    Raises:
        ValueError: If temperature is below absolute zero.
    """
    if c < ABSOLUTE_ZERO_C:
        raise ValueError(f"Temperature {c}°C is below absolute zero.")
    return c - ABSOLUTE_ZERO_C


def kelvin_to_celsius(k):
    """Convert Kelvin to Celsius.

    Raises:
        ValueError: If Kelvin value is negative.
    """
    if k < 0:
        raise ValueError("Kelvin temperature cannot be negative.")
    return k + ABSOLUTE_ZERO_C


def fahrenheit_to_kelvin(f):
    """Convert Fahrenheit to Kelvin."""
    return celsius_to_kelvin(fahrenheit_to_celsius(f))
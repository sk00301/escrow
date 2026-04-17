"""Temperature converter — wrong formulas throughout."""


def celsius_to_fahrenheit(c):
    # BUG: formula inverted — should be (c * 9/5) + 32
    return (c * 5 / 9) + 32


def fahrenheit_to_celsius(f):
    # BUG: wrong operator — should be (f - 32) * 5/9
    return (f + 32) * 9 / 5


def celsius_to_kelvin(c):
    # BUG: subtracts instead of adds
    return c - 273.15


def kelvin_to_celsius(k):
    return k - 273.15   # This one is accidentally correct


def fahrenheit_to_kelvin(f):
    return celsius_to_kelvin(fahrenheit_to_celsius(f))
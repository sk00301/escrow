"""Calculator — basic operations. Division edge case not handled."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def multiply(a, b):
    return a * b


def divide(a, b):
    # Missing zero-division guard
    return a / b


def power(base, exp):
    return base ** exp


def modulo(a, b):
    return a % b
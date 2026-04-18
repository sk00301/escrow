"""Calculator — completely wrong division logic."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def multiply(a, b):
    # BUG: uses addition instead of multiplication
    return a + b


def divide(a, b):
    # BUG: returns b/a instead of a/b, and no zero guard
    return b / a


def power(base, exp):
    # BUG: adds instead of exponentiating
    return base + exp


def modulo(a, b):
    return a % b
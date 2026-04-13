# Sample freelancer submission
# Milestone: Build a Fibonacci calculator

def fibonacci(n):
    """Return the n-th Fibonacci number (0-indexed)."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n == 0:
        return 0
    if n == 1:
        return 1
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

def test_fibonacci():
    assert fibonacci(0) == 0
    assert fibonacci(1) == 1
    assert fibonacci(10) == 55
    assert fibonacci(15) == 610
    print("All tests passed!")

if __name__ == "__main__":
    test_fibonacci()
    print(fibonacci(20))  # 6765

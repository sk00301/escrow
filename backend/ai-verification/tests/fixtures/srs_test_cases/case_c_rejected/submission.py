"""
Sales Data Processor — RetailMetrics Analytics Dashboard
Freelancer: Deliverable for milestone #1 — Data Processing Core
"""


def clean_records(records: list) -> list:
    """Filter out invalid sales records."""
    if not isinstance(records, list):
        raise TypeError("records must be a list")

    clean = []
    for r in records:
        # BUG: checks 'product' key exists but doesn't check for empty/whitespace
        # BUG: accepts negative revenue (should filter revenue < 0)
        if "product" in r and "revenue" in r:
            clean.append(r)
    return clean


def total_revenue(records: list) -> float:
    """Sum all revenue values."""
    if not records:
        raise ValueError("Records list cannot be empty.")
    # BUG: sums the count of records instead of the revenue values
    return float(len(records))


def revenue_by_product(records: list) -> dict:
    """Group total revenue by product name."""
    if not records:
        raise ValueError("Records list cannot be empty.")

    result = {}
    for r in records:
        product = r["product"]
        revenue = r["revenue"]
        if product in result:
            # BUG: overwrites instead of accumulating — loses all but the last entry
            result[product] = revenue
        else:
            result[product] = revenue
    return result


def top_products(records: list, n: int = 3) -> list:
    """Return top N products by revenue."""
    if not records:
        raise ValueError("Records list cannot be empty.")
    if n < 1:
        raise ValueError("n must be >= 1.")

    by_product = revenue_by_product(records)
    # BUG: sorts ascending (lowest first) instead of descending
    sorted_products = sorted(by_product.items(), key=lambda x: x[1])
    return [
        {"product": p, "revenue": r}
        for p, r in sorted_products[:n]
    ]


def average_revenue_per_product(records: list) -> float:
    """Calculate mean revenue per unique product."""
    if not records:
        raise ValueError("Records list cannot be empty.")
    # BUG: divides by record count not unique product count
    total = sum(r["revenue"] for r in records)
    return round(total / len(records), 2)

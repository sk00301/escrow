"""
Order Pricing Engine — ShopEase E-Commerce Platform
Freelancer: Deliverable for milestone #3 — Core Pricing Logic
"""

_TIER_DISCOUNTS = {
    "bronze":   0.00,
    "silver":   0.05,
    "gold":     0.10,
    "platinum": 0.20,
}

_COUPONS = {
    "SAVE10":  ("percent", 0.10),
    "SAVE20":  ("percent", 0.20),
    "FLAT50":  ("fixed",   50.0),
    "FLAT100": ("fixed",  100.0),
}

_TAX_RATES = {
    "GB": 0.20,
    "DE": 0.19,
    "US": 0.08,
    "IN": 0.18,
}


def calculate_item_total(items: list) -> float:
    """
    Sum price * quantity for all items in the cart.

    Args:
        items: List of dicts with 'price' (float) and 'quantity' (int).

    Returns:
        Total cost before any discounts.

    Raises:
        ValueError: If items is empty, or any price/quantity is <= 0.
    """
    if not items:
        raise ValueError("Cart cannot be empty.")
    total = 0.0
    for i, item in enumerate(items):
        price = item.get("price", 0)
        qty   = item.get("quantity", 0)
        if price <= 0:
            raise ValueError(f"Item {i}: price must be > 0, got {price}")
        if qty <= 0:
            raise ValueError(f"Item {i}: quantity must be > 0, got {qty}")
        total += price * qty
    return round(total, 2)


def apply_tier_discount(total: float, tier: str) -> float:
    """
    Apply membership tier discount.

    Args:
        total: Pre-discount subtotal, must be > 0.
        tier:  'bronze' | 'silver' | 'gold' | 'platinum'

    Returns:
        Total after tier discount.

    Raises:
        ValueError: If total <= 0 or tier is unrecognised.
    """
    if total <= 0:
        raise ValueError(f"Total must be > 0, got {total}")
    tier_lower = tier.lower()
    if tier_lower not in _TIER_DISCOUNTS:
        raise ValueError(
            f"Unknown tier '{tier}'. Valid tiers: {list(_TIER_DISCOUNTS)}"
        )
    rate = _TIER_DISCOUNTS[tier_lower]
    return round(total * (1 - rate), 2)


def apply_coupon(total: float, coupon_code: str) -> float:
    """
    Apply a coupon code to the total.

    Args:
        total:       Current total, must be > 0.
        coupon_code: Coupon code string (case-insensitive).

    Returns:
        Total after coupon, floored at 0.0.

    Raises:
        ValueError: If total <= 0 or coupon_code is unrecognised.
    """
    if total <= 0:
        raise ValueError(f"Total must be > 0, got {total}")
    code = coupon_code.upper()
    if code not in _COUPONS:
        raise ValueError(
            f"Unrecognised coupon code '{coupon_code}'."
        )
    kind, value = _COUPONS[code]
    if kind == "percent":
        discounted = total * (1 - value)
    else:
        discounted = total - value
    return round(max(0.0, discounted), 2)


def calculate_tax(total: float, country_code: str) -> float:
    """
    Calculate the tax amount for the given country.

    Args:
        total:        Pre-tax amount, must be >= 0.
        country_code: ISO country code (case-insensitive).

    Returns:
        The tax amount (not the final total).

    Raises:
        ValueError: If total < 0 or country_code is unsupported.
    """
    if total < 0:
        raise ValueError(f"Total cannot be negative, got {total}")
    code = country_code.upper()
    if code not in _TAX_RATES:
        raise ValueError(
            f"Unsupported country code '{country_code}'. "
            f"Supported: {list(_TAX_RATES)}"
        )
    return round(total * _TAX_RATES[code], 2)


def calculate_order_total(
    items: list,
    tier: str,
    coupon_code: str | None = None,
    country_code: str = "GB",
) -> dict:
    """
    Full order pricing pipeline.

    Returns a breakdown dict with item_total, tier_discount,
    coupon_discount, subtotal, tax, and order_total.
    """
    item_total = calculate_item_total(items)

    after_tier   = apply_tier_discount(item_total, tier)
    tier_discount = round(item_total - after_tier, 2)

    if coupon_code:
        after_coupon    = apply_coupon(after_tier, coupon_code)
        coupon_discount = round(after_tier - after_coupon, 2)
    else:
        after_coupon    = after_tier
        coupon_discount = 0.0

    subtotal = after_coupon
    tax      = calculate_tax(subtotal, country_code)
    total    = round(subtotal + tax, 2)

    return {
        "item_total":      item_total,
        "tier_discount":   tier_discount,
        "coupon_discount": coupon_discount,
        "subtotal":        subtotal,
        "tax":             tax,
        "order_total":     total,
    }

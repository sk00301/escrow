"""
pricing.py
──────────
Pricing calculations for the E-commerce Order Processing System.

All monetary return values are floats rounded to 2 decimal places
where the SRS specifies rounding.
"""


def calculate_subtotal(inventory, items):
    """
    Return the subtotal for a list of order items.

    Parameters
    ----------
    inventory : dict
        In-memory inventory store (read-only).
    items : list[dict]
        Line items: [{"sku": str, "qty": int}, ...].

    Returns
    -------
    float
        Sum of (unit_price * qty) for all items.

    Raises
    ------
    KeyError
        If any SKU is not found in inventory.
    """
    total = 0.0
    for item in items:
        sku = item["sku"]
        if sku not in inventory:
            raise KeyError(f"SKU {sku!r} not found in inventory")
        total += inventory[sku]["unit_price"] * item["qty"]
    return round(total, 2)


def apply_discount(subtotal, discount_pct):
    """
    Apply a percentage discount to a subtotal.

    Parameters
    ----------
    subtotal : float
        Pre-discount amount.
    discount_pct : float
        Discount percentage (0–100).

    Returns
    -------
    float
        Discounted amount, rounded to 2 decimal places.

    Raises
    ------
    ValueError
        If discount_pct < 0 or > 100.
    """
    if discount_pct < 0 or discount_pct > 100:
        raise ValueError(
            f"discount_pct must be between 0 and 100, got {discount_pct}"
        )
    return round(subtotal * (1 - discount_pct / 100), 2)


def calculate_tax(amount, tax_rate):
    """
    Return the tax amount for a given amount and tax rate.

    Parameters
    ----------
    amount : float
        The taxable amount.
    tax_rate : float
        Tax rate as a fraction (0–1). E.g. 0.20 for 20%.

    Returns
    -------
    float
        Tax amount (not the total), rounded to 2 decimal places.

    Raises
    ------
    ValueError
        If tax_rate < 0 or > 1.
    """
    if tax_rate < 0 or tax_rate > 1:
        raise ValueError(f"tax_rate must be between 0 and 1, got {tax_rate}")
    return round(amount * tax_rate, 2)


def apply_promo_code(promo_codes, code, subtotal):
    """
    Apply a promotional discount code to a subtotal.

    Parameters
    ----------
    promo_codes : dict
        Mapping of code string to discount percentage.
        E.g. {"SAVE10": 10.0, "HALF": 50.0}.
    code : str
        The promo code to apply.
    subtotal : float
        Pre-discount amount.

    Returns
    -------
    float
        Discounted subtotal, rounded to 2 decimal places.

    Raises
    ------
    ValueError
        If the code is not found in promo_codes.
    """
    if code not in promo_codes:
        raise ValueError(f"Promo code {code!r} is not valid")
    discount_pct = promo_codes[code]
    return apply_discount(subtotal, discount_pct)


def order_total(inventory, items, discount_pct, tax_rate):
    """
    Compute the final order total including discount and tax.

    Pipeline:
        subtotal   = calculate_subtotal(inventory, items)
        discounted = apply_discount(subtotal, discount_pct)
        tax        = calculate_tax(discounted, tax_rate)
        total      = discounted + tax

    Parameters
    ----------
    inventory : dict
        In-memory inventory store (read-only).
    items : list[dict]
        Line items: [{"sku": str, "qty": int}, ...].
    discount_pct : float
        Discount percentage (0–100).
    tax_rate : float
        Tax rate as a fraction (0–1).

    Returns
    -------
    float
        Final total, rounded to 2 decimal places.

    Raises
    ------
    KeyError
        If any SKU is missing from inventory.
    ValueError
        If discount_pct or tax_rate is out of range.
    """
    subtotal   = calculate_subtotal(inventory, items)
    discounted = apply_discount(subtotal, discount_pct)
    tax        = calculate_tax(discounted, tax_rate)
    return round(discounted + tax, 2)

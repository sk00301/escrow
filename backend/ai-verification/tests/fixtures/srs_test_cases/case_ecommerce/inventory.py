"""
inventory.py
────────────
Stock management for the E-commerce Order Processing System.

Each product is stored under its SKU key:

    inventory[sku] = {
        "name":       str,
        "quantity":   int,
        "unit_price": float,
    }
"""


def add_stock(inventory, sku, name, quantity, unit_price):
    """
    Add a new product or increase stock for an existing SKU.

    Parameters
    ----------
    inventory : dict
        In-memory inventory store (mutated in place).
    sku : str
        Unique product identifier (non-empty).
    name : str
        Display name (non-empty).
    quantity : int
        Units to add (>= 0).
    unit_price : float
        Price per unit (> 0).

    Raises
    ------
    ValueError
        If sku or name is empty, quantity < 0, or unit_price <= 0.
    """
    if not sku or not sku.strip():
        raise ValueError("sku must not be empty")
    if not name or not name.strip():
        raise ValueError("name must not be empty")
    if quantity < 0:
        raise ValueError(f"quantity must be >= 0, got {quantity}")
    if unit_price <= 0:
        raise ValueError(f"unit_price must be > 0, got {unit_price}")

    if sku in inventory:
        inventory[sku]["quantity"]   += quantity
        inventory[sku]["unit_price"]  = unit_price
    else:
        inventory[sku] = {
            "name":       name.strip(),
            "quantity":   quantity,
            "unit_price": unit_price,
        }


def deduct_stock(inventory, sku, quantity):
    """
    Reduce stock level for a SKU.

    Parameters
    ----------
    inventory : dict
        In-memory inventory store (mutated in place).
    sku : str
        Product SKU to deduct from.
    quantity : int
        Number of units to deduct (must not exceed current stock).

    Raises
    ------
    KeyError
        If the SKU is not in inventory.
    ValueError
        If deducting would result in negative stock.
    """
    if sku not in inventory:
        raise KeyError(f"SKU {sku!r} not found in inventory")
    new_qty = inventory[sku]["quantity"] - quantity
    if new_qty < 0:
        raise ValueError(
            f"Insufficient stock for SKU {sku!r}: "
            f"have {inventory[sku]['quantity']}, need {quantity}"
        )
    inventory[sku]["quantity"] = new_qty


def get_stock_level(inventory, sku):
    """
    Return the current quantity for a SKU.

    Parameters
    ----------
    inventory : dict
        In-memory inventory store.
    sku : str
        Product SKU to look up.

    Returns
    -------
    int
        Current quantity in stock.

    Raises
    ------
    KeyError
        If the SKU is not found.
    """
    if sku not in inventory:
        raise KeyError(f"SKU {sku!r} not found in inventory")
    return inventory[sku]["quantity"]


def low_stock_skus(inventory, threshold):
    """
    Return a sorted list of SKUs whose stock level is at or below threshold.

    Parameters
    ----------
    inventory : dict
        In-memory inventory store.
    threshold : int
        Maximum quantity that qualifies as low stock (inclusive).

    Returns
    -------
    list[str]
        Sorted list of SKU strings. Empty list if none qualify.
    """
    return sorted(
        sku for sku, record in inventory.items()
        if record["quantity"] <= threshold
    )

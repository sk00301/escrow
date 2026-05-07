"""
orders.py
─────────
Order lifecycle management for the E-commerce Order Processing System.

Each order is stored under its order_id key:

    orders[order_id] = {
        "customer_id": str,
        "items":       list[dict],   # [{"sku": str, "qty": int}, ...]
        "status":      str,          # "PENDING" | "FULFILLED" | "CANCELLED"
    }
"""

from inventory import deduct_stock, get_stock_level


def create_order(orders, order_id, customer_id, items):
    """
    Create a new order in PENDING status.

    Parameters
    ----------
    orders : dict
        In-memory orders store (mutated in place).
    order_id : str
        Unique order identifier.
    customer_id : str
        ID of the customer placing the order.
    items : list[dict]
        List of line items: [{"sku": str, "qty": int}, ...].
        Must be non-empty; each item qty must be >= 1.

    Raises
    ------
    ValueError
        If order_id already exists, items is empty, or any qty < 1.
    """
    if order_id in orders:
        raise ValueError(f"order_id {order_id!r} already exists")
    if not items:
        raise ValueError("items must not be empty")
    for item in items:
        if item["qty"] < 1:
            raise ValueError(
                f"item qty must be >= 1, got {item['qty']} for SKU {item['sku']!r}"
            )

    orders[order_id] = {
        "customer_id": customer_id,
        "items":       [dict(item) for item in items],
        "status":      "PENDING",
    }


def fulfil_order(orders, inventory, order_id):
    """
    Fulfil a PENDING order — deduct stock atomically and mark FULFILLED.

    Atomicity guarantee: if ANY item has insufficient stock, no stock is
    deducted and the order status remains PENDING.

    Parameters
    ----------
    orders : dict
        In-memory orders store (mutated in place).
    inventory : dict
        In-memory inventory store (mutated in place via deduct_stock).
    order_id : str
        ID of the order to fulfil.

    Raises
    ------
    KeyError
        If order_id is not found.
    ValueError
        If order status is not PENDING.
    ValueError
        If any item has insufficient stock (no stock is deducted).
    """
    if order_id not in orders:
        raise KeyError(f"order_id {order_id!r} not found")
    order = orders[order_id]
    if order["status"] != "PENDING":
        raise ValueError(
            f"Cannot fulfil order {order_id!r} — status is {order['status']!r}"
        )

    # Pre-flight check: verify ALL items have sufficient stock before deducting any
    for item in order["items"]:
        sku, qty = item["sku"], item["qty"]
        current = get_stock_level(inventory, sku)
        if current < qty:
            raise ValueError(
                f"Insufficient stock for SKU {sku!r}: have {current}, need {qty}"
            )

    # All checks passed — now deduct atomically
    for item in order["items"]:
        deduct_stock(inventory, item["sku"], item["qty"])

    orders[order_id]["status"] = "FULFILLED"


def cancel_order(orders, order_id):
    """
    Cancel a PENDING order, setting its status to CANCELLED.

    Parameters
    ----------
    orders : dict
        In-memory orders store (mutated in place).
    order_id : str
        ID of the order to cancel.

    Raises
    ------
    KeyError
        If order_id is not found.
    ValueError
        If the order is not in PENDING status (e.g. already FULFILLED).
    """
    if order_id not in orders:
        raise KeyError(f"order_id {order_id!r} not found")
    if orders[order_id]["status"] != "PENDING":
        raise ValueError(
            f"Cannot cancel order {order_id!r} — status is {orders[order_id]['status']!r}"
        )
    orders[order_id]["status"] = "CANCELLED"


def get_orders_by_customer(orders, customer_id):
    """
    Return all orders placed by a customer.

    Parameters
    ----------
    orders : dict
        In-memory orders store.
    customer_id : str
        Customer ID to filter by.

    Returns
    -------
    list[tuple[str, dict]]
        List of (order_id, order_record) tuples. Empty list if none found.
    """
    return [
        (oid, record)
        for oid, record in orders.items()
        if record["customer_id"] == customer_id
    ]


def order_summary(orders, order_id):
    """
    Return a summary dict for a given order.

    Parameters
    ----------
    orders : dict
        In-memory orders store.
    order_id : str
        ID of the order to summarise.

    Returns
    -------
    dict with keys:
        order_id    (str)
        customer_id (str)
        status      (str)
        item_count  (int)  — number of line items (not total units)
        total_qty   (int)  — sum of all item qtys

    Raises
    ------
    KeyError
        If order_id is not found.
    """
    if order_id not in orders:
        raise KeyError(f"order_id {order_id!r} not found")
    order = orders[order_id]
    return {
        "order_id":    order_id,
        "customer_id": order["customer_id"],
        "status":      order["status"],
        "item_count":  len(order["items"]),
        "total_qty":   sum(item["qty"] for item in order["items"]),
    }

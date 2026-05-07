# Software Requirements Specification (SRS)

## 1. Project Overview

**Project Name:** E-commerce Order Processing System
**Language:** Python 3.x
**Files:** `inventory.py`, `orders.py`, `pricing.py`
**Description:**
A three-module order processing system. `inventory.py` manages stock levels.
`orders.py` handles order lifecycle (create, fulfil, cancel). `pricing.py`
calculates totals, taxes, and applies promotional discount codes.

---

## 2. Module: `inventory.py`

### Function: `add_stock(inventory, sku, name, quantity, unit_price)`

**Purpose:** Add a new product to inventory or increase quantity of an
existing SKU. Raises `ValueError` for negative quantity or unit_price.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| inventory | dict | In-memory inventory store |
| sku | str | Unique product SKU (non-empty) |
| name | str | Product display name (non-empty) |
| quantity | int | Units to add (>= 0) |
| unit_price | float | Price per unit (> 0) |

**Returns:** `None` — mutates inventory in place.

**Raises:**
- `ValueError` if quantity < 0
- `ValueError` if unit_price <= 0
- `ValueError` if sku or name is empty

**Behaviour:** If the SKU already exists, add `quantity` to current stock
and update `unit_price`. If the SKU is new, create the record.

---

### Function: `deduct_stock(inventory, sku, quantity)`

**Purpose:** Reduce stock for a SKU. Raises `ValueError` if the resulting
quantity would go below 0. Raises `KeyError` if SKU not found.

---

### Function: `get_stock_level(inventory, sku)`

**Purpose:** Return current quantity for a SKU. Raises `KeyError` if not found.

---

### Function: `low_stock_skus(inventory, threshold)`

**Purpose:** Return a sorted list of SKUs whose quantity is <= threshold.
Returns `[]` if none qualify.

---

## 3. Module: `orders.py`

### Function: `create_order(orders, order_id, customer_id, items)`

**Purpose:** Create a new order record.

`items` is a list of dicts: `[{"sku": str, "qty": int}, ...]`

**Raises:**
- `ValueError` if order_id already exists
- `ValueError` if items is empty
- `ValueError` if any item qty < 1

**The order record shape:**
```python
orders[order_id] = {
    "customer_id": str,
    "items":       list,   # copy of items
    "status":      "PENDING",
}
```

---

### Function: `fulfil_order(orders, inventory, order_id)`

**Purpose:** Fulfil a PENDING order — deduct stock for every item and
set status to "FULFILLED".

**Raises:**
- `KeyError` if order_id not found
- `ValueError` if order status is not PENDING
- `ValueError` if any item has insufficient stock (check ALL items before
  deducting any — atomic behaviour)

---

### Function: `cancel_order(orders, order_id)`

**Purpose:** Cancel a PENDING order, setting status to "CANCELLED".

**Raises:**
- `KeyError` if order_id not found
- `ValueError` if status is not PENDING (cannot cancel a fulfilled order)

---

### Function: `get_orders_by_customer(orders, customer_id)`

**Purpose:** Return a list of `(order_id, order_record)` tuples for the
given customer. Returns `[]` if none found.

---

### Function: `order_summary(orders, order_id)`

**Purpose:** Return a dict summarising the order:
```python
{
  "order_id":    str,
  "customer_id": str,
  "status":      str,
  "item_count":  int,   # total number of line items (not total qty)
  "total_qty":   int,   # sum of all item qtys
}
```

**Raises:** `KeyError` if order_id not found.

---

## 4. Module: `pricing.py`

### Function: `calculate_subtotal(inventory, items)`

**Purpose:** Return the subtotal (float) for a list of items by looking up
`unit_price` from inventory. Raises `KeyError` if any SKU is missing.

---

### Function: `apply_discount(subtotal, discount_pct)`

**Purpose:** Return the discounted total. `discount_pct` is 0–100 (percent).
Raises `ValueError` if discount_pct < 0 or > 100.

---

### Function: `calculate_tax(amount, tax_rate)`

**Purpose:** Return the tax amount (not the total). `tax_rate` is 0–1 (fraction).
Raises `ValueError` if tax_rate < 0 or > 1.

---

### Function: `apply_promo_code(promo_codes, code, subtotal)`

**Purpose:** Look up `code` in the `promo_codes` dict and return the
discounted subtotal. If the code is not found, raise `ValueError`.

`promo_codes` format: `{"SAVE10": 10.0, "HALF": 50.0}` (values are percent off).

---

### Function: `order_total(inventory, items, discount_pct, tax_rate)`

**Purpose:** Compute and return the final order total:

    subtotal  = calculate_subtotal(inventory, items)
    discounted = apply_discount(subtotal, discount_pct)
    tax        = calculate_tax(discounted, tax_rate)
    total      = discounted + tax

Return the total rounded to 2 decimal places.

---

## 5. Acceptance Criteria (Full)

- All twelve functions implemented correctly
- `fulfil_order` is atomic: if any item has insufficient stock, NO stock is deducted
- `order_total` chains all pricing helpers correctly
- All monetary outputs rounded to 2 decimal places where specified
- All functions have docstrings

---

## 9. Milestone Deliverables

### Milestone 1 — Inventory management
**Due:** 2026-07-01
**Required functions:** add_stock, deduct_stock, get_stock_level, low_stock_skus
**Required keywords:** inventory, SKU, stock, ValueError, KeyError, threshold
**Test scope:** pytest tests/unit/m1/
**Acceptance criteria:** Implement the four inventory.py functions. add_stock must add quantity to existing SKUs and create new ones. deduct_stock must raise ValueError when quantity would go negative. low_stock_skus must return a sorted list of SKUs at or below the threshold.

---

### Milestone 2 — Order lifecycle
**Due:** 2026-07-15
**Required functions:** create_order, fulfil_order, cancel_order, get_orders_by_customer, order_summary
**Required keywords:** order, PENDING, FULFILLED, CANCELLED, atomic, customer
**Test scope:** pytest tests/unit/m2/
**Acceptance criteria:** Implement the five orders.py functions. fulfil_order must be atomic — if any item lacks sufficient stock, no stock is deducted and no status is changed. cancel_order must reject fulfilled orders. order_summary must compute item_count and total_qty correctly.
**Weight test:** 0.65
**Weight pylint:** 0.25
**Weight flake8:** 0.10

---

### Milestone 3 — Pricing and final delivery
**Due:** 2026-08-01
**Required functions:** add_stock, deduct_stock, get_stock_level, low_stock_skus, create_order, fulfil_order, cancel_order, get_orders_by_customer, order_summary, calculate_subtotal, apply_discount, calculate_tax, apply_promo_code, order_total
**Required keywords:** inventory, SKU, stock, order, PENDING, FULFILLED, CANCELLED, atomic, subtotal, discount, tax, promo
**Test scope:** pytest tests/
**Acceptance criteria:** All twelve functions fully implemented. order_total must chain calculate_subtotal, apply_discount, and calculate_tax correctly. Monetary results must be rounded to 2 decimal places. apply_promo_code must raise ValueError for unknown codes. All functions have docstrings.

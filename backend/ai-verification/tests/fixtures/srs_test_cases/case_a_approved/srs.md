# Software Requirements Specification (SRS)
# Project: Order Pricing Engine
# Client: ShopEase E-Commerce Platform
# Version: 1.0

## 1. Project Overview

**Project Name:** Order Pricing Engine
**Module/File:** submission.py
**Language:** Python 3.x
**Description:**
A core pricing engine for an e-commerce platform. Given a cart of items,
a customer tier, and optional coupon codes, the engine calculates the
final order total including item discounts, tier-based discounts, coupon
discounts, and tax. This module is called on every checkout — correctness
and edge-case handling are critical.


---

## 2. Functions Required

### Function: `calculate_item_total(items: list[dict]) -> float`

**Purpose:**
Sum the total cost of all items in the cart before any discounts..

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| items | list[dict] | Each dict has `"price": float` and `"quantity": int` |

**Returns:**
| Type | Description |
|------|-------------|
| float | Sum of price * quantity for all items |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If items list is empty |
| ValueError | If any item has price <= 0 |
| ValueError | If any item has quantity <= 0 |

**Examples:**
```python
calculate_item_total([{"price": 10.0, "quantity": 2}])          # → 20.0
calculate_item_total([{"price": 5.5, "quantity": 3},
                      {"price": 2.0, "quantity": 1}])            # → 18.5
```

**Edge Cases:**
- Single item with quantity 1
- Multiple items with different prices
- Float prices (currency precision matters)

---

### Function: `apply_tier_discount(total: float, tier: str) -> float`

**Purpose:**
Apply a percentage discount based on the customer's membership tier.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| total | float | Pre-discount subtotal, must be > 0 |
| tier | str | Customer tier: "bronze", "silver", "gold", "platinum" |

**Tier Discount Rates:**
| Tier | Discount |
|------|----------|
| bronze | 0% (no discount) |
| silver | 5% |
| gold | 10% |
| platinum | 20% |

**Returns:**
| Type | Description |
|------|-------------|
| float | Total after tier discount applied |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If total <= 0 |
| ValueError | If tier is not one of the four valid values |

**Examples:**
```python
apply_tier_discount(100.0, "gold")      # → 90.0
apply_tier_discount(100.0, "bronze")    # → 100.0
apply_tier_discount(200.0, "platinum")  # → 160.0
```

---

### Function: `apply_coupon(total: float, coupon_code: str) -> float`

**Purpose:**
Apply a coupon code discount to the total.

**Valid Coupon Codes:**
| Code | Type | Value |
|------|------|-------|
| SAVE10 | percentage | 10% off |
| SAVE20 | percentage | 20% off |
| FLAT50 | fixed amount | £50 off |
| FLAT100 | fixed amount | £100 off |

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| total | float | Current total before coupon, must be > 0 |
| coupon_code | str | Coupon code string (case-insensitive) |

**Returns:**
| Type | Description |
|------|-------------|
| float | Total after coupon applied, minimum 0.0 (never negative) |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If coupon_code is not a recognised code |
| ValueError | If total <= 0 |

**Examples:**
```python
apply_coupon(100.0, "SAVE10")   # → 90.0
apply_coupon(100.0, "FLAT50")   # → 50.0
apply_coupon(30.0,  "FLAT50")   # → 0.0  (never goes negative)
apply_coupon(100.0, "save20")   # → 80.0 (case-insensitive)
```

---

### Function: `calculate_tax(total: float, country_code: str) -> float`

**Purpose:**
Calculate the tax amount (NOT the final total — just the tax value) for a given country.

**Tax Rates:**
| Country Code | Tax Rate |
|--------------|----------|
| GB | 20% (UK VAT) |
| DE | 19% (German VAT) |
| US | 8% (simplified US sales tax) |
| IN | 18% (Indian GST) |

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| total | float | Pre-tax total, must be >= 0 |
| country_code | str | ISO country code (case-insensitive) |

**Returns:**
| Type | Description |
|------|-------------|
| float | The tax AMOUNT (not the final total) |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If country_code is not supported |
| ValueError | If total < 0 |

**Examples:**
```python
calculate_tax(100.0, "GB")   # → 20.0
calculate_tax(100.0, "DE")   # → 19.0
calculate_tax(0.0, "GB")     # → 0.0
```

---

### Function: `calculate_order_total(items, tier, coupon_code=None, country_code="GB") -> dict`

**Purpose:**
Full pipeline — combines all the above into a final order summary.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| items | list[dict] | Cart items |
| tier | str | Customer tier |
| coupon_code | str or None | Optional coupon |
| country_code | str | Country for tax |

**Returns:**
```python
{
    "item_total":       float,   # before any discounts
    "tier_discount":    float,   # amount saved from tier
    "coupon_discount":  float,   # amount saved from coupon
    "subtotal":         float,   # after discounts, before tax
    "tax":              float,   # tax amount
    "order_total":      float,   # final amount customer pays
}
```

**Raises:**
Propagates all ValueError exceptions from the sub-functions.

---

## 4. Acceptance Criteria

- MUST raise ValueError for empty cart
- MUST raise ValueError for invalid tier
- MUST raise ValueError for invalid coupon code
- MUST raise ValueError for unsupported country code
- MUST never produce a negative order total
- Final order_total MUST equal subtotal + tax
- Coupon codes MUST be case-insensitive
- FLAT coupons MUST floor at 0.0 (not go negative)
- tier_discount and coupon_discount in the result MUST reflect actual amounts saved

---

## 5. Boundary Values

| Input | Expected | Notes |
|-------|----------|-------|
| FLAT100 coupon on £50 order | subtotal = 0.0 | Floor at zero |
| "gb" country code | valid, 20% tax | Case-insensitive |
| price = 0 | raises ValueError | Zero price invalid |
| quantity = 0 | raises ValueError | Zero quantity invalid |
| "diamond" tier | raises ValueError | Unknown tier |
| "BOGOF" coupon | raises ValueError | Unknown coupon |

# Software Requirements Specification (SRS)
# Project: Sales Data Processor
# Client: RetailMetrics Analytics Dashboard
# Version: 1.0

## 1. Project Overview

**Project Name:** Sales Data Processor
**Module/File:** submission.py
**Language:** Python 3.x
**Description:**
A data processing module for the RetailMetrics analytics dashboard.
Ingests raw sales records (as lists of dicts), cleans the data,
computes aggregated metrics, and identifies top performers.
This module runs nightly on real sales data — correctness of
aggregation logic is the #1 requirement.

---

## 2. Functions Required

### Function: `clean_records(records: list[dict]) -> list[dict]`

**Purpose:**
Filter out invalid records from raw sales data. A record is valid if:
- It has both `"product"` (non-empty string) and `"revenue"` (numeric) keys
- `"revenue"` is >= 0
- `"product"` is not an empty string or whitespace-only

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| records | list[dict] | Raw sales records |

**Returns:**
| Type | Description |
|------|-------------|
| list[dict] | Only the valid records, preserving original order |

**Raises:**
| Exception | When |
|-----------|------|
| TypeError | If records is not a list |

**Examples:**
```python
raw = [
    {"product": "Widget", "revenue": 100.0},
    {"product": "",       "revenue": 50.0},    # invalid — empty product
    {"product": "Gadget", "revenue": -10.0},   # invalid — negative revenue
    {"product": "Donut",  "revenue": 0.0},     # valid — zero revenue ok
    {"revenue": 200.0},                         # invalid — missing product key
]
clean_records(raw)
# → [{"product": "Widget", "revenue": 100.0},
#    {"product": "Donut",  "revenue": 0.0}]
```

---

### Function: `total_revenue(records: list[dict]) -> float`

**Purpose:**
Sum the `"revenue"` field across all records.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| records | list[dict] | Clean sales records |

**Returns:**
| Type | Description |
|------|-------------|
| float | Sum of all revenue values |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If records list is empty |

**Examples:**
```python
total_revenue([{"product": "A", "revenue": 100.0},
               {"product": "B", "revenue": 250.0}])   # → 350.0
total_revenue([{"product": "A", "revenue": 0.0}])     # → 0.0
```

---

### Function: `revenue_by_product(records: list[dict]) -> dict`

**Purpose:**
Aggregate total revenue grouped by product name.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| records | list[dict] | Clean sales records |

**Returns:**
| Type | Description |
|------|-------------|
| dict | `{product_name: total_revenue}` mapping |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If records list is empty |

**Examples:**
```python
records = [
    {"product": "Widget", "revenue": 100.0},
    {"product": "Widget", "revenue": 50.0},
    {"product": "Gadget", "revenue": 200.0},
]
revenue_by_product(records)
# → {"Widget": 150.0, "Gadget": 200.0}
```

---

### Function: `top_products(records: list[dict], n: int = 3) -> list[dict]`

**Purpose:**
Return the top N products by total revenue, sorted highest first.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| records | list[dict] | Clean sales records |
| n | int | Number of top products to return, must be >= 1 |

**Returns:**
| Type | Description |
|------|-------------|
| list[dict] | List of `{"product": str, "revenue": float}` sorted descending |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If records is empty |
| ValueError | If n < 1 |

**Examples:**
```python
records = [
    {"product": "A", "revenue": 300.0},
    {"product": "B", "revenue": 100.0},
    {"product": "C", "revenue": 500.0},
    {"product": "D", "revenue": 200.0},
]
top_products(records, n=2)
# → [{"product": "C", "revenue": 500.0},
#    {"product": "A", "revenue": 300.0}]
```

---

### Function: `average_revenue_per_product(records: list[dict]) -> float`

**Purpose:**
Calculate the mean revenue per unique product (not per record).

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| records | list[dict] | Clean sales records |

**Returns:**
| Type | Description |
|------|-------------|
| float | Total revenue divided by number of UNIQUE products |

**Raises:**
| Exception | When |
|-----------|------|
| ValueError | If records is empty |

**Examples:**
```python
records = [
    {"product": "A", "revenue": 100.0},
    {"product": "A", "revenue": 100.0},   # same product
    {"product": "B", "revenue": 200.0},
]
# Total = 400, unique products = 2 (A and B)
average_revenue_per_product(records)  # → 200.0
```

---

## 4. Acceptance Criteria

- MUST filter records missing "product" or "revenue" keys
- MUST filter records where revenue < 0
- MUST filter records where product is empty or whitespace
- MUST preserve record order in clean_records
- MUST correctly aggregate revenue when a product appears multiple times
- `top_products` MUST sort by revenue descending
- `top_products` MUST handle n > number of unique products (return all)
- `average_revenue_per_product` MUST divide by unique product count, NOT record count
- MUST raise ValueError for empty records where noted

---

## 5. Boundary Values

| Input | Expected | Notes |
|-------|----------|-------|
| revenue = 0.0 | kept by clean_records | Zero is valid |
| revenue = -0.01 | removed by clean_records | Negative removed |
| product = "  " | removed by clean_records | Whitespace-only invalid |
| n > unique products | return all products | Don't crash |
| n = 1 | return only top 1 | Minimum n |
| n = 0 | raises ValueError | Invalid n |
| single record | correct result | Edge case |

---

## 7. Sample Input / Output

```python
raw = [
    {"product": "Laptop",  "revenue": 1200.0},
    {"product": "Mouse",   "revenue": 25.0},
    {"product": "Laptop",  "revenue": 800.0},
    {"product": "Monitor", "revenue": 400.0},
    {"product": "",        "revenue": 100.0},   # filtered
    {"product": "Mouse",   "revenue": -5.0},    # filtered
]

clean = clean_records(raw)
# → 4 valid records (empty and negative removed)

print(total_revenue(clean))          # → 2425.0
print(revenue_by_product(clean))
# → {"Laptop": 2000.0, "Mouse": 25.0, "Monitor": 400.0}

print(top_products(clean, n=2))
# → [{"product": "Laptop", "revenue": 2000.0},
#    {"product": "Monitor", "revenue": 400.0}]

print(average_revenue_per_product(clean))
# → 808.33...  (2425 / 3 unique products)
```

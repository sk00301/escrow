"""
tests/unit/m3/test_pricing_and_e2e.py
──────────────────────────────────────
Milestone 3 tests — Pricing module + end-to-end order pipeline.
Covers: calculate_subtotal, apply_discount, calculate_tax,
        apply_promo_code, order_total, and full system integration.

Run with:
    pytest tests/unit/m3/ -v
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from inventory import add_stock, get_stock_level
from orders import create_order, fulfil_order, cancel_order, order_summary
from pricing import (
    calculate_subtotal,
    apply_discount,
    calculate_tax,
    apply_promo_code,
    order_total,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def inventory():
    inv = {}
    add_stock(inv, "SKU-001", "Widget A",  100, 10.00)
    add_stock(inv, "SKU-002", "Widget B",   50, 20.00)
    add_stock(inv, "SKU-003", "Gadget Pro",  5, 100.00)
    return inv


@pytest.fixture
def orders():
    return {}


@pytest.fixture
def promo_codes():
    return {
        "SAVE10":  10.0,
        "HALF":    50.0,
        "FREE":   100.0,
        "PENNY":   99.0,
    }


# ── calculate_subtotal ────────────────────────────────────────────────────────

class TestCalculateSubtotal:

    def test_single_item(self, inventory):
        items = [{"sku": "SKU-001", "qty": 3}]
        assert calculate_subtotal(inventory, items) == 30.00

    def test_multiple_items(self, inventory):
        items = [{"sku": "SKU-001", "qty": 2}, {"sku": "SKU-002", "qty": 1}]
        assert calculate_subtotal(inventory, items) == 40.00

    def test_single_unit(self, inventory):
        items = [{"sku": "SKU-003", "qty": 1}]
        assert calculate_subtotal(inventory, items) == 100.00

    def test_large_quantity(self, inventory):
        items = [{"sku": "SKU-001", "qty": 100}]
        assert calculate_subtotal(inventory, items) == 1000.00

    def test_unknown_sku_raises_key_error(self, inventory):
        with pytest.raises(KeyError):
            calculate_subtotal(inventory, [{"sku": "UNKNOWN", "qty": 1}])

    def test_returns_float(self, inventory):
        result = calculate_subtotal(inventory, [{"sku": "SKU-001", "qty": 1}])
        assert isinstance(result, float)

    def test_result_rounded_to_two_decimals(self):
        inv = {}
        add_stock(inv, "X", "Frac", 10, 3.333)
        items = [{"sku": "X", "qty": 3}]
        result = calculate_subtotal(inv, items)
        assert result == round(3.333 * 3, 2)

    def test_mixed_quantities(self, inventory):
        items = [
            {"sku": "SKU-001", "qty": 5},   # 5 * 10 = 50
            {"sku": "SKU-002", "qty": 2},   # 2 * 20 = 40
            {"sku": "SKU-003", "qty": 1},   # 1 * 100 = 100
        ]
        assert calculate_subtotal(inventory, items) == 190.00


# ── apply_discount ────────────────────────────────────────────────────────────

class TestApplyDiscount:

    def test_no_discount(self):
        assert apply_discount(100.00, 0) == 100.00

    def test_ten_percent_discount(self):
        assert apply_discount(100.00, 10) == 90.00

    def test_fifty_percent_discount(self):
        assert apply_discount(200.00, 50) == 100.00

    def test_full_discount(self):
        assert apply_discount(100.00, 100) == 0.00

    def test_negative_discount_raises_value_error(self):
        with pytest.raises(ValueError):
            apply_discount(100.00, -1)

    def test_over_100_discount_raises_value_error(self):
        with pytest.raises(ValueError):
            apply_discount(100.00, 101)

    def test_returns_float(self):
        result = apply_discount(100.00, 10)
        assert isinstance(result, float)

    def test_result_rounded_to_two_decimals(self):
        result = apply_discount(99.99, 10)
        assert result == round(99.99 * 0.90, 2)

    def test_fractional_discount(self):
        result = apply_discount(100.00, 33.333)
        assert isinstance(result, float)
        assert 0 < result < 100


# ── calculate_tax ─────────────────────────────────────────────────────────────

class TestCalculateTax:

    def test_twenty_percent_tax(self):
        assert calculate_tax(100.00, 0.20) == 20.00

    def test_zero_tax_rate(self):
        assert calculate_tax(100.00, 0) == 0.00

    def test_full_tax_rate(self):
        assert calculate_tax(100.00, 1.0) == 100.00

    def test_tax_rate_above_one_raises_value_error(self):
        with pytest.raises(ValueError):
            calculate_tax(100.00, 1.01)

    def test_negative_tax_rate_raises_value_error(self):
        with pytest.raises(ValueError):
            calculate_tax(100.00, -0.01)

    def test_returns_tax_amount_not_total(self):
        # Tax on £200 at 20% is £40, not £240
        assert calculate_tax(200.00, 0.20) == 40.00

    def test_returns_float(self):
        result = calculate_tax(100.00, 0.20)
        assert isinstance(result, float)

    def test_result_rounded_to_two_decimals(self):
        result = calculate_tax(99.99, 0.20)
        assert result == round(99.99 * 0.20, 2)

    def test_five_percent_tax(self):
        assert calculate_tax(50.00, 0.05) == 2.50


# ── apply_promo_code ──────────────────────────────────────────────────────────

class TestApplyPromoCode:

    def test_valid_code_applies_discount(self, promo_codes):
        result = apply_promo_code(promo_codes, "SAVE10", 100.00)
        assert result == 90.00

    def test_half_off_code(self, promo_codes):
        result = apply_promo_code(promo_codes, "HALF", 200.00)
        assert result == 100.00

    def test_free_code_returns_zero(self, promo_codes):
        result = apply_promo_code(promo_codes, "FREE", 150.00)
        assert result == 0.00

    def test_unknown_code_raises_value_error(self, promo_codes):
        with pytest.raises(ValueError, match="not valid"):
            apply_promo_code(promo_codes, "INVALID", 100.00)

    def test_empty_code_raises_value_error(self, promo_codes):
        with pytest.raises(ValueError):
            apply_promo_code(promo_codes, "", 100.00)

    def test_case_sensitive_code(self, promo_codes):
        with pytest.raises(ValueError):
            apply_promo_code(promo_codes, "save10", 100.00)

    def test_returns_float(self, promo_codes):
        result = apply_promo_code(promo_codes, "SAVE10", 100.00)
        assert isinstance(result, float)

    def test_penny_code_leaves_small_remainder(self, promo_codes):
        result = apply_promo_code(promo_codes, "PENNY", 100.00)
        assert result == 1.00


# ── order_total ───────────────────────────────────────────────────────────────

class TestOrderTotal:

    def test_no_discount_no_tax(self, inventory):
        items = [{"sku": "SKU-001", "qty": 2}]  # 2 * 10 = 20
        assert order_total(inventory, items, 0, 0) == 20.00

    def test_with_discount_no_tax(self, inventory):
        items = [{"sku": "SKU-001", "qty": 10}]  # 100.00
        # 10% off → 90.00, no tax
        assert order_total(inventory, items, 10, 0) == 90.00

    def test_no_discount_with_tax(self, inventory):
        items = [{"sku": "SKU-001", "qty": 10}]  # 100.00
        # No discount, 20% tax → 100 + 20 = 120.00
        assert order_total(inventory, items, 0, 0.20) == 120.00

    def test_discount_then_tax(self, inventory):
        items = [{"sku": "SKU-001", "qty": 10}]  # 100.00
        # 10% off → 90.00; 20% tax on 90 → 18.00; total = 108.00
        assert order_total(inventory, items, 10, 0.20) == 108.00

    def test_multiple_items(self, inventory):
        items = [
            {"sku": "SKU-001", "qty": 2},   # 20.00
            {"sku": "SKU-002", "qty": 1},   # 20.00
        ]
        # subtotal=40, no discount, 10% tax → 4, total=44
        assert order_total(inventory, items, 0, 0.10) == 44.00

    def test_unknown_sku_raises_key_error(self, inventory):
        with pytest.raises(KeyError):
            order_total(inventory, [{"sku": "UNKNOWN", "qty": 1}], 0, 0)

    def test_invalid_discount_raises_value_error(self, inventory):
        with pytest.raises(ValueError):
            order_total(inventory, [{"sku": "SKU-001", "qty": 1}], 110, 0)

    def test_invalid_tax_rate_raises_value_error(self, inventory):
        with pytest.raises(ValueError):
            order_total(inventory, [{"sku": "SKU-001", "qty": 1}], 0, 1.5)

    def test_returns_float_rounded_to_two_decimals(self, inventory):
        items = [{"sku": "SKU-001", "qty": 3}]
        result = order_total(inventory, items, 0, 0)
        assert isinstance(result, float)
        assert result == round(result, 2)

    def test_full_discount_gives_zero_before_tax(self, inventory):
        items = [{"sku": "SKU-001", "qty": 5}]
        # 100% discount → 0; tax on 0 → 0
        assert order_total(inventory, items, 100, 0.20) == 0.00


# ── End-to-end integration ────────────────────────────────────────────────────

class TestEndToEndOrderPipeline:

    def test_create_fulfil_check_stock(self, orders, inventory, promo_codes):
        create_order(orders, "ORD-001", "CUST-A", [
            {"sku": "SKU-001", "qty": 5},
            {"sku": "SKU-002", "qty": 2},
        ])
        fulfil_order(orders, inventory, "ORD-001")
        assert get_stock_level(inventory, "SKU-001") == 95
        assert get_stock_level(inventory, "SKU-002") == 48

    def test_cancel_does_not_affect_stock(self, orders, inventory):
        before = get_stock_level(inventory, "SKU-001")
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 10}])
        cancel_order(orders, "ORD-001")
        assert get_stock_level(inventory, "SKU-001") == before

    def test_pricing_pipeline_on_real_inventory(self, inventory, promo_codes):
        items = [{"sku": "SKU-001", "qty": 3}, {"sku": "SKU-002", "qty": 1}]
        subtotal    = calculate_subtotal(inventory, items)     # 30 + 20 = 50
        discounted  = apply_promo_code(promo_codes, "SAVE10", subtotal)  # 45
        tax         = calculate_tax(discounted, 0.20)          # 9
        total       = round(discounted + tax, 2)               # 54
        assert subtotal   == 50.00
        assert discounted == 45.00
        assert tax        == 9.00
        assert total      == 54.00

    def test_order_total_consistent_with_manual_calculation(self, inventory):
        items = [{"sku": "SKU-001", "qty": 4}]   # 40.00
        # 25% off → 30.00; 10% tax → 3.00; total = 33.00
        assert order_total(inventory, items, 25, 0.10) == 33.00

    def test_atomic_fulfil_no_partial_deduction(self, orders, inventory):
        """If the second item fails, the first must not be deducted."""
        qty_before = get_stock_level(inventory, "SKU-001")
        create_order(orders, "ORD-BAD", "CUST-A", [
            {"sku": "SKU-001", "qty": 1},
            {"sku": "SKU-003", "qty": 999},   # way more than available
        ])
        with pytest.raises(ValueError):
            fulfil_order(orders, inventory, "ORD-BAD")
        assert get_stock_level(inventory, "SKU-001") == qty_before

    def test_two_customers_compete_for_last_stock(self, orders, inventory):
        add_stock(inventory, "SKU-LIMITED", "Last Widget", 1, 50.00)
        create_order(orders, "ORD-A", "CUST-A", [{"sku": "SKU-LIMITED", "qty": 1}])
        create_order(orders, "ORD-B", "CUST-B", [{"sku": "SKU-LIMITED", "qty": 1}])
        fulfil_order(orders, inventory, "ORD-A")
        with pytest.raises(ValueError):
            fulfil_order(orders, inventory, "ORD-B")
        assert orders["ORD-B"]["status"] == "PENDING"

    def test_docstrings_exist_on_all_functions(self):
        from inventory import add_stock, deduct_stock, get_stock_level, low_stock_skus
        from orders import (create_order, fulfil_order, cancel_order,
                            get_orders_by_customer, order_summary)
        from pricing import (calculate_subtotal, apply_discount, calculate_tax,
                             apply_promo_code, order_total)
        funcs = [
            add_stock, deduct_stock, get_stock_level, low_stock_skus,
            create_order, fulfil_order, cancel_order, get_orders_by_customer, order_summary,
            calculate_subtotal, apply_discount, calculate_tax, apply_promo_code, order_total,
        ]
        for fn in funcs:
            assert fn.__doc__ and fn.__doc__.strip(), \
                f"{fn.__name__} is missing a docstring"

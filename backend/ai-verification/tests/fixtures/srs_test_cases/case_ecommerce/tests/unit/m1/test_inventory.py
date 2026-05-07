"""
tests/unit/m1/test_inventory.py
────────────────────────────────
Milestone 1 tests — Inventory management.
Covers: add_stock, deduct_stock, get_stock_level, low_stock_skus.

Run with:
    pytest tests/unit/m1/ -v
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from inventory import add_stock, deduct_stock, get_stock_level, low_stock_skus


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def empty_inventory():
    return {}


@pytest.fixture
def inventory():
    inv = {}
    add_stock(inv, "SKU-001", "Widget A",     100, 9.99)
    add_stock(inv, "SKU-002", "Widget B",      50, 19.99)
    add_stock(inv, "SKU-003", "Gadget Pro",     5, 99.99)
    add_stock(inv, "SKU-004", "Budget Item",  200, 2.49)
    add_stock(inv, "SKU-005", "Out of Stock",   0, 14.99)
    return inv


# ── add_stock ─────────────────────────────────────────────────────────────────

class TestAddStock:

    def test_add_new_sku_creates_record(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "Widget A", 10, 9.99)
        assert "SKU-001" in empty_inventory

    def test_record_has_correct_fields(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "Widget A", 10, 9.99)
        rec = empty_inventory["SKU-001"]
        assert rec["name"]       == "Widget A"
        assert rec["quantity"]   == 10
        assert rec["unit_price"] == 9.99

    def test_add_to_existing_sku_increments_quantity(self, inventory):
        before = inventory["SKU-001"]["quantity"]
        add_stock(inventory, "SKU-001", "Widget A", 50, 9.99)
        assert inventory["SKU-001"]["quantity"] == before + 50

    def test_add_to_existing_sku_updates_price(self, inventory):
        add_stock(inventory, "SKU-001", "Widget A", 0, 12.99)
        assert inventory["SKU-001"]["unit_price"] == 12.99

    def test_add_zero_quantity_is_allowed(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "Widget A", 0, 9.99)
        assert empty_inventory["SKU-001"]["quantity"] == 0

    def test_negative_quantity_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError, match="quantity"):
            add_stock(empty_inventory, "SKU-001", "Widget A", -1, 9.99)

    def test_zero_unit_price_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError, match="unit_price"):
            add_stock(empty_inventory, "SKU-001", "Widget A", 10, 0)

    def test_negative_unit_price_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError, match="unit_price"):
            add_stock(empty_inventory, "SKU-001", "Widget A", 10, -5.0)

    def test_empty_sku_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError):
            add_stock(empty_inventory, "", "Widget A", 10, 9.99)

    def test_whitespace_sku_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError):
            add_stock(empty_inventory, "   ", "Widget A", 10, 9.99)

    def test_empty_name_raises_value_error(self, empty_inventory):
        with pytest.raises(ValueError):
            add_stock(empty_inventory, "SKU-001", "", 10, 9.99)

    def test_name_is_stripped(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "  Widget A  ", 10, 9.99)
        assert empty_inventory["SKU-001"]["name"] == "Widget A"

    def test_multiple_skus(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "A", 10, 1.00)
        add_stock(empty_inventory, "SKU-002", "B", 20, 2.00)
        assert len(empty_inventory) == 2

    def test_large_quantity(self, empty_inventory):
        add_stock(empty_inventory, "SKU-001", "Widget A", 1_000_000, 0.01)
        assert empty_inventory["SKU-001"]["quantity"] == 1_000_000


# ── deduct_stock ──────────────────────────────────────────────────────────────

class TestDeductStock:

    def test_deduct_reduces_quantity(self, inventory):
        before = inventory["SKU-001"]["quantity"]
        deduct_stock(inventory, "SKU-001", 10)
        assert inventory["SKU-001"]["quantity"] == before - 10

    def test_deduct_all_stock_sets_zero(self, inventory):
        qty = inventory["SKU-003"]["quantity"]
        deduct_stock(inventory, "SKU-003", qty)
        assert inventory["SKU-003"]["quantity"] == 0

    def test_deduct_one_unit(self, inventory):
        before = inventory["SKU-002"]["quantity"]
        deduct_stock(inventory, "SKU-002", 1)
        assert inventory["SKU-002"]["quantity"] == before - 1

    def test_deduct_more_than_available_raises_value_error(self, inventory):
        with pytest.raises(ValueError, match="Insufficient stock"):
            deduct_stock(inventory, "SKU-003", 999)

    def test_deduct_from_zero_stock_raises_value_error(self, inventory):
        with pytest.raises(ValueError):
            deduct_stock(inventory, "SKU-005", 1)

    def test_deduct_unknown_sku_raises_key_error(self, inventory):
        with pytest.raises(KeyError):
            deduct_stock(inventory, "UNKNOWN", 1)

    def test_deduct_does_not_change_other_skus(self, inventory):
        before_002 = inventory["SKU-002"]["quantity"]
        deduct_stock(inventory, "SKU-001", 5)
        assert inventory["SKU-002"]["quantity"] == before_002


# ── get_stock_level ───────────────────────────────────────────────────────────

class TestGetStockLevel:

    def test_returns_correct_quantity(self, inventory):
        assert get_stock_level(inventory, "SKU-001") == 100

    def test_returns_zero_for_out_of_stock(self, inventory):
        assert get_stock_level(inventory, "SKU-005") == 0

    def test_unknown_sku_raises_key_error(self, inventory):
        with pytest.raises(KeyError):
            get_stock_level(inventory, "UNKNOWN")

    def test_returns_int(self, inventory):
        result = get_stock_level(inventory, "SKU-001")
        assert isinstance(result, int)

    def test_reflects_after_deduct(self, inventory):
        deduct_stock(inventory, "SKU-001", 30)
        assert get_stock_level(inventory, "SKU-001") == 70

    def test_reflects_after_add(self, inventory):
        add_stock(inventory, "SKU-001", "Widget A", 50, 9.99)
        assert get_stock_level(inventory, "SKU-001") == 150


# ── low_stock_skus ────────────────────────────────────────────────────────────

class TestLowStockSkus:

    def test_returns_skus_at_or_below_threshold(self, inventory):
        result = low_stock_skus(inventory, 5)
        assert "SKU-003" in result  # qty=5, at threshold
        assert "SKU-005" in result  # qty=0

    def test_threshold_inclusive(self, inventory):
        result = low_stock_skus(inventory, 5)
        assert "SKU-003" in result

    def test_above_threshold_excluded(self, inventory):
        result = low_stock_skus(inventory, 5)
        assert "SKU-001" not in result  # qty=100
        assert "SKU-002" not in result  # qty=50

    def test_threshold_zero_returns_out_of_stock_only(self, inventory):
        result = low_stock_skus(inventory, 0)
        assert result == ["SKU-005"]

    def test_high_threshold_returns_all(self, inventory):
        result = low_stock_skus(inventory, 1_000_000)
        assert len(result) == len(inventory)

    def test_returns_sorted_list(self, inventory):
        result = low_stock_skus(inventory, 100)
        assert result == sorted(result)

    def test_returns_list_type(self, inventory):
        result = low_stock_skus(inventory, 10)
        assert isinstance(result, list)

    def test_empty_inventory_returns_empty(self, empty_inventory):
        result = low_stock_skus(empty_inventory, 5)
        assert result == []

    def test_no_low_stock_returns_empty(self, inventory):
        result = low_stock_skus(inventory, -1)
        assert result == []

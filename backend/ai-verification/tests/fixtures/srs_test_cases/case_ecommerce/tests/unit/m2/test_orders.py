"""
tests/unit/m2/test_orders.py
─────────────────────────────
Milestone 2 tests — Order lifecycle management.
Covers: create_order, fulfil_order, cancel_order,
        get_orders_by_customer, order_summary.

Run with:
    pytest tests/unit/m2/ -v
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from inventory import add_stock
from orders import (
    create_order,
    fulfil_order,
    cancel_order,
    get_orders_by_customer,
    order_summary,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def inventory():
    inv = {}
    add_stock(inv, "SKU-001", "Widget A",  50, 9.99)
    add_stock(inv, "SKU-002", "Widget B",  10, 19.99)
    add_stock(inv, "SKU-003", "Gadget",     2, 49.99)
    add_stock(inv, "SKU-004", "Last One",   1, 99.99)
    add_stock(inv, "SKU-005", "No Stock",   0, 14.99)
    return inv


@pytest.fixture
def orders():
    return {}


@pytest.fixture
def pending_order(orders, inventory):
    create_order(orders, "ORD-001", "CUST-A",
                 [{"sku": "SKU-001", "qty": 2}, {"sku": "SKU-002", "qty": 1}])
    return orders


# ── create_order ──────────────────────────────────────────────────────────────

class TestCreateOrder:

    def test_creates_order_record(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        assert "ORD-001" in orders

    def test_status_is_pending(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        assert orders["ORD-001"]["status"] == "PENDING"

    def test_customer_id_stored(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        assert orders["ORD-001"]["customer_id"] == "CUST-A"

    def test_items_stored_as_copy(self, orders):
        items = [{"sku": "SKU-001", "qty": 3}]
        create_order(orders, "ORD-001", "CUST-A", items)
        items.clear()
        assert len(orders["ORD-001"]["items"]) == 1

    def test_multiple_line_items(self, orders):
        items = [{"sku": "SKU-001", "qty": 2}, {"sku": "SKU-002", "qty": 5}]
        create_order(orders, "ORD-001", "CUST-A", items)
        assert len(orders["ORD-001"]["items"]) == 2

    def test_duplicate_order_id_raises_value_error(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        with pytest.raises(ValueError, match="already exists"):
            create_order(orders, "ORD-001", "CUST-B", [{"sku": "SKU-001", "qty": 1}])

    def test_empty_items_raises_value_error(self, orders):
        with pytest.raises(ValueError, match="empty"):
            create_order(orders, "ORD-001", "CUST-A", [])

    def test_item_qty_zero_raises_value_error(self, orders):
        with pytest.raises(ValueError):
            create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 0}])

    def test_item_qty_negative_raises_value_error(self, orders):
        with pytest.raises(ValueError):
            create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": -3}])

    def test_multiple_orders_independent(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        create_order(orders, "ORD-002", "CUST-B", [{"sku": "SKU-002", "qty": 2}])
        assert len(orders) == 2


# ── fulfil_order ──────────────────────────────────────────────────────────────

class TestFulfilOrder:

    def test_fulfil_sets_status_to_fulfilled(self, pending_order, inventory):
        fulfil_order(pending_order, inventory, "ORD-001")
        assert pending_order["ORD-001"]["status"] == "FULFILLED"

    def test_fulfil_deducts_stock_for_all_items(self, pending_order, inventory):
        before_001 = inventory["SKU-001"]["quantity"]
        before_002 = inventory["SKU-002"]["quantity"]
        fulfil_order(pending_order, inventory, "ORD-001")
        assert inventory["SKU-001"]["quantity"] == before_001 - 2
        assert inventory["SKU-002"]["quantity"] == before_002 - 1

    def test_fulfil_unknown_order_raises_key_error(self, orders, inventory):
        with pytest.raises(KeyError):
            fulfil_order(orders, inventory, "UNKNOWN")

    def test_fulfil_already_fulfilled_raises_value_error(self, pending_order, inventory):
        fulfil_order(pending_order, inventory, "ORD-001")
        with pytest.raises(ValueError):
            fulfil_order(pending_order, inventory, "ORD-001")

    def test_fulfil_cancelled_order_raises_value_error(self, pending_order, inventory):
        cancel_order(pending_order, "ORD-001")
        with pytest.raises(ValueError):
            fulfil_order(pending_order, inventory, "ORD-001")

    def test_fulfil_insufficient_stock_raises_value_error(self, orders, inventory):
        create_order(orders, "ORD-BIG", "CUST-A",
                     [{"sku": "SKU-001", "qty": 9999}])
        with pytest.raises(ValueError, match="Insufficient stock"):
            fulfil_order(orders, inventory, "ORD-BIG")

    def test_fulfil_no_stock_atomic_no_deduction(self, orders, inventory):
        """
        Atomicity: if the second item has insufficient stock, the first
        item's stock must NOT be deducted.
        """
        before_001 = inventory["SKU-001"]["quantity"]
        before_005 = inventory["SKU-005"]["quantity"]
        create_order(orders, "ORD-ATOMIC", "CUST-A", [
            {"sku": "SKU-001", "qty": 1},   # enough stock
            {"sku": "SKU-005", "qty": 1},   # NO stock
        ])
        with pytest.raises(ValueError):
            fulfil_order(orders, inventory, "ORD-ATOMIC")
        # Neither item should have been deducted
        assert inventory["SKU-001"]["quantity"] == before_001
        assert inventory["SKU-005"]["quantity"] == before_005

    def test_fulfil_atomic_status_unchanged_on_failure(self, orders, inventory):
        create_order(orders, "ORD-ATOMIC", "CUST-A", [
            {"sku": "SKU-001", "qty": 1},
            {"sku": "SKU-005", "qty": 1},
        ])
        with pytest.raises(ValueError):
            fulfil_order(orders, inventory, "ORD-ATOMIC")
        assert orders["ORD-ATOMIC"]["status"] == "PENDING"

    def test_fulfil_last_unit_clears_stock(self, orders, inventory):
        create_order(orders, "ORD-LAST", "CUST-A",
                     [{"sku": "SKU-004", "qty": 1}])
        fulfil_order(orders, inventory, "ORD-LAST")
        assert inventory["SKU-004"]["quantity"] == 0

    def test_fulfil_multiple_independent_orders(self, orders, inventory):
        create_order(orders, "ORD-A", "CUST-A", [{"sku": "SKU-001", "qty": 5}])
        create_order(orders, "ORD-B", "CUST-B", [{"sku": "SKU-001", "qty": 3}])
        fulfil_order(orders, inventory, "ORD-A")
        fulfil_order(orders, inventory, "ORD-B")
        assert inventory["SKU-001"]["quantity"] == 50 - 5 - 3


# ── cancel_order ──────────────────────────────────────────────────────────────

class TestCancelOrder:

    def test_cancel_pending_sets_cancelled(self, pending_order):
        cancel_order(pending_order, "ORD-001")
        assert pending_order["ORD-001"]["status"] == "CANCELLED"

    def test_cancel_unknown_order_raises_key_error(self, orders):
        with pytest.raises(KeyError):
            cancel_order(orders, "UNKNOWN")

    def test_cancel_fulfilled_order_raises_value_error(self, pending_order, inventory):
        fulfil_order(pending_order, inventory, "ORD-001")
        with pytest.raises(ValueError):
            cancel_order(pending_order, "ORD-001")

    def test_cancel_already_cancelled_raises_value_error(self, pending_order):
        cancel_order(pending_order, "ORD-001")
        with pytest.raises(ValueError):
            cancel_order(pending_order, "ORD-001")

    def test_cancel_does_not_affect_inventory(self, pending_order, inventory):
        before = inventory["SKU-001"]["quantity"]
        cancel_order(pending_order, "ORD-001")
        assert inventory["SKU-001"]["quantity"] == before


# ── get_orders_by_customer ────────────────────────────────────────────────────

class TestGetOrdersByCustomer:

    def test_returns_orders_for_customer(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        create_order(orders, "ORD-002", "CUST-A", [{"sku": "SKU-002", "qty": 2}])
        create_order(orders, "ORD-003", "CUST-B", [{"sku": "SKU-001", "qty": 1}])
        result = get_orders_by_customer(orders, "CUST-A")
        assert len(result) == 2
        ids = [oid for oid, _ in result]
        assert "ORD-001" in ids
        assert "ORD-002" in ids

    def test_unknown_customer_returns_empty(self, orders):
        result = get_orders_by_customer(orders, "UNKNOWN")
        assert result == []

    def test_returns_list_of_tuples(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        result = get_orders_by_customer(orders, "CUST-A")
        assert isinstance(result, list)
        assert isinstance(result[0], tuple)

    def test_tuple_contains_order_id_and_record(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        result = get_orders_by_customer(orders, "CUST-A")
        oid, record = result[0]
        assert oid == "ORD-001"
        assert record["customer_id"] == "CUST-A"

    def test_does_not_return_other_customers_orders(self, orders):
        create_order(orders, "ORD-001", "CUST-B", [{"sku": "SKU-001", "qty": 1}])
        result = get_orders_by_customer(orders, "CUST-A")
        assert result == []


# ── order_summary ─────────────────────────────────────────────────────────────

class TestOrderSummary:

    def test_summary_has_correct_keys(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 2}])
        s = order_summary(orders, "ORD-001")
        assert "order_id"    in s
        assert "customer_id" in s
        assert "status"      in s
        assert "item_count"  in s
        assert "total_qty"   in s

    def test_summary_order_id(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 2}])
        assert order_summary(orders, "ORD-001")["order_id"] == "ORD-001"

    def test_summary_item_count(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [
            {"sku": "SKU-001", "qty": 5},
            {"sku": "SKU-002", "qty": 3},
        ])
        assert order_summary(orders, "ORD-001")["item_count"] == 2

    def test_summary_total_qty(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [
            {"sku": "SKU-001", "qty": 5},
            {"sku": "SKU-002", "qty": 3},
        ])
        assert order_summary(orders, "ORD-001")["total_qty"] == 8

    def test_summary_status_reflects_current_state(self, orders, inventory):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        assert order_summary(orders, "ORD-001")["status"] == "PENDING"
        fulfil_order(orders, inventory, "ORD-001")
        assert order_summary(orders, "ORD-001")["status"] == "FULFILLED"

    def test_summary_unknown_order_raises_key_error(self, orders):
        with pytest.raises(KeyError):
            order_summary(orders, "UNKNOWN")

    def test_summary_single_item_single_qty(self, orders):
        create_order(orders, "ORD-001", "CUST-A", [{"sku": "SKU-001", "qty": 1}])
        s = order_summary(orders, "ORD-001")
        assert s["item_count"] == 1
        assert s["total_qty"]  == 1

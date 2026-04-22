import pytest

from submission import (
    calculate_item_total,
    apply_tier_discount,
    apply_coupon,
    calculate_tax,
    calculate_order_total,
)


class TestCalculateItemTotal:
    def test_calculate_item_total_happy_path(self):
        items = [
            {"price": 10.0, "quantity": 2},
            {"price": 5.5, "quantity": 3},
            {"price": 2.0, "quantity": 1},
        ]
        expected = 20.0 + 18.5
        assert calculate_item_total(items) == pytest.approx(expected)

    def test_calculate_item_total_empty_cart(self):
        with pytest.raises(ValueError, match="Cart cannot be empty."):
            calculate_item_total([])

    def test_calculate_item_total_negative_price(self):
        items = [{"price": -10.0, "quantity": 2}]
        with pytest.raises(ValueError, match=r"Item \d+: price must be > 0, got -10\.0"):
            calculate_item_total(items)

    def test_calculate_item_total_zero_quantity(self):
        items = [{"price": 10.0, "quantity": 0}]
        with pytest.raises(ValueError, match=r"Item \d+: quantity must be > 0, got 0"):
            calculate_item_total(items)

    def test_calculate_item_total_boundary_value_negative_price(self):
        items = [{"price": 0.0, "quantity": 2}]
        with pytest.raises(ValueError, match="raises ValueError"):
            calculate_item_total(items)

    def test_calculate_item_total_boundary_value_zero_quantity(self):
        items = [{"price": 10.0, "quantity": 0}]
        with pytest.raises(ValueError, match="raises ValueError"):
            calculate_item_total(items)


class TestApplyTierDiscount:
    def test_apply_tier_discount_happy_path(self):
        total = 100.0
        tier = "gold"
        expected = 90.0
        assert apply_tier_discount(total, tier) == pytest.approx(expected)

    def test_apply_tier_discount_invalid_total(self):
        with pytest.raises(ValueError, match="Total must be > 0"):
            apply_tier_discount(0.0, "gold")

    def test_apply_tier_discount_invalid_tier(self):
        total = 100.0
        tier = "diamond"
        with pytest.raises(ValueError, match=r"Unknown tier 'diamond'. Valid tiers: \['bronze', 'silver', 'gold', 'platinum'\]"):
            apply_tier_discount(total, tier)


class TestApplyCoupon:
    def test_apply_coupon_happy_path(self):
        total = 100.0
        coupon_code = "SAVE10"
        expected = 90.0
        assert apply_coupon(total, coupon_code) == pytest.approx(expected)

    def test_apply_coupon_invalid_total(self):
        with pytest.raises(ValueError, match="Total must be > 0"):
            apply_coupon(0.0, "SAVE10")

    def test_apply_coupon_unrecognised_coupon(self):
        total = 100.0
        coupon_code = "SAVE25"
        with pytest.raises(ValueError, match=r"Unrecognised coupon code 'SAVE25'."):
            apply_coupon(total, coupon_code)


class TestCalculateTax:
    def test_calculate_tax_happy_path(self):
        total = 100.0
        country_code = "GB"
        expected = 20.0
        assert calculate_tax(total, country_code) == pytest.approx(expected)

    def test_calculate_tax_invalid_total(self):
        with pytest.raises(ValueError, match="Total cannot be negative"):
            calculate_tax(-10.0, "GB")

    def test_calculate_tax_unsupported_country(self):
        total = 100.0
        country_code = "FR"
        with pytest.raises(ValueError, match=r"Unsupported country code 'FR'. Supported: \['GB', 'DE', 'US', 'IN'\]"):
            calculate_tax(total, country_code)


class TestCalculateOrderTotal:
    def test_calculate_order_total_happy_path(self):
        items = [
            {"price": 10.0, "quantity": 2},
            {"price": 5.5, "quantity": 3},
            {"price": 2.0, "quantity": 1},
        ]
        tier = "gold"
        coupon_code = None
        country_code = "GB"
        expected_item_total = pytest.approx(20.0 + 18.5)
        expected_tier_discount = pytest.approx(90.0 - 90.0 * 0.10)
        expected_coupon_discount = pytest.approx(90.0 - 90.0 * 0.10)
        expected_subtotal = pytest.approx(expected_item_total + expected_tier_discount)
        expected_tax = pytest.approx(expected_subtotal * 0.20)
        expected_order_total = pytest.approx(
            expected_subtotal + expected_tax
        )
        result = calculate_order_total(items, tier, coupon_code, country_code)
        assert result == {
            "item_total": expected_item_total,
            "tier_discount": expected_tier_discount,
            "coupon_discount": expected_coupon_discount,
            "subtotal": expected_subtotal,
            "tax": expected_tax,
            "order_total": expected_order_total,
        }

    def test_calculate_order_total_empty_cart(self):
        with pytest.raises(ValueError, match="Cart cannot be empty."):
            calculate_order_total([], "gold", None, "GB")

    def test_calculate_order_total_negative_price(self):
        items = [{"price": -10.0, "quantity": 2}]
        tier = "gold"
        coupon_code = None
        country_code = "GB"
        with pytest.raises(ValueError, match=r"Item \d+: price must be > 0, got -10\.0"):
            calculate_order_total(items, tier, coupon_code, country_code)

    def test_calculate_order_total_zero_quantity(self):
        items = [{"price": 10.0, "quantity": 0}]
        tier = "gold"
        coupon_code = None
        country_code = "GB"
        with pytest.raises(ValueError, match=r"Item \d+: quantity must be > 0, got 0"):
            calculate_order_total(items, tier, coupon_code, country_code)

    def test_calculate_order_total_boundary_value_negative_price(self):
        items = [{"price": 0.0, "quantity": 2}]
        tier = "gold"
        coupon_code = None
        country_code = "GB"
        with pytest.raises(ValueError, match="raises ValueError"):
            calculate_order_total(items, tier, coupon_code, country_code)

    def test_calculate_order_total_boundary_value_zero_quantity(self):
        items = [{"price": 10.0, "quantity": 0}]
        tier = "gold"
        coupon_code = None
        country_code = "GB"
        with pytest.raises(ValueError, match="raises ValueError"):
            calculate_order_total(items, tier, coupon_code, country_code)
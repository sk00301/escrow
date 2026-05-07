"""
tests/unit/m2/test_members.py
──────────────────────────────
Milestone 2 tests — Member management and borrowing.
Covers: register_member, borrow_book, return_book, get_member_loans.

Run with:
    pytest tests/unit/m2/ -v
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from catalog import add_book
from members import (
    register_member,
    borrow_book,
    return_book,
    get_member_loans,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def catalog():
    c = {}
    add_book(c, "9780134685991", "Effective Java", "Joshua Bloch", 3)
    add_book(c, "9780132350884", "Clean Code", "Robert Martin", 1)
    add_book(c, "9780201633610", "Design Patterns", "Gang of Four", 2)
    return c


@pytest.fixture
def members():
    return {}


@pytest.fixture
def populated_members(members):
    register_member(members, "M001", "Alice Smith", "alice@example.com")
    register_member(members, "M002", "Bob Jones",  "bob@example.com")
    return members


# ── register_member ───────────────────────────────────────────────────────────

class TestRegisterMember:

    def test_register_creates_record(self, members):
        register_member(members, "M001", "Alice Smith", "alice@example.com")
        assert "M001" in members

    def test_record_has_correct_fields(self, members):
        register_member(members, "M001", "Alice Smith", "alice@example.com")
        record = members["M001"]
        assert record["name"] == "Alice Smith"
        assert record["email"] == "alice@example.com"
        assert record["borrowed"] == []

    def test_borrowed_list_starts_empty(self, members):
        register_member(members, "M001", "Alice Smith", "alice@example.com")
        assert members["M001"]["borrowed"] == []

    def test_duplicate_member_id_raises_value_error(self, members):
        register_member(members, "M001", "Alice Smith", "alice@example.com")
        with pytest.raises(ValueError, match="already registered"):
            register_member(members, "M001", "Other Name", "other@example.com")

    def test_invalid_email_no_at_raises_value_error(self, members):
        with pytest.raises(ValueError, match="invalid email"):
            register_member(members, "M001", "Alice Smith", "aliceexample.com")

    def test_empty_name_raises_value_error(self, members):
        with pytest.raises(ValueError):
            register_member(members, "M001", "", "alice@example.com")

    def test_whitespace_name_raises_value_error(self, members):
        with pytest.raises(ValueError):
            register_member(members, "M001", "   ", "alice@example.com")

    def test_name_is_stripped(self, members):
        register_member(members, "M001", "  Alice Smith  ", "alice@example.com")
        assert members["M001"]["name"] == "Alice Smith"

    def test_register_multiple_members(self, members):
        register_member(members, "M001", "Alice Smith", "alice@example.com")
        register_member(members, "M002", "Bob Jones",   "bob@example.com")
        assert len(members) == 2


# ── borrow_book ───────────────────────────────────────────────────────────────

class TestBorrowBook:

    def test_borrow_adds_isbn_to_member_list(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        assert "9780134685991" in populated_members["M001"]["borrowed"]

    def test_borrow_decrements_available(self, populated_members, catalog):
        before = catalog["9780134685991"]["available"]
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        assert catalog["9780134685991"]["available"] == before - 1

    def test_borrow_last_copy_sets_available_to_zero(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780132350884")
        assert catalog["9780132350884"]["available"] == 0

    def test_borrow_when_no_copies_raises_value_error(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780132350884")
        with pytest.raises(ValueError):
            borrow_book(populated_members, catalog, "M002", "9780132350884")

    def test_borrow_unknown_member_raises_key_error(self, populated_members, catalog):
        with pytest.raises(KeyError):
            borrow_book(populated_members, catalog, "UNKNOWN", "9780134685991")

    def test_borrow_unknown_isbn_raises_key_error(self, populated_members, catalog):
        with pytest.raises(KeyError):
            borrow_book(populated_members, catalog, "M001", "9780000000000")

    def test_same_member_borrows_two_books(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        borrow_book(populated_members, catalog, "M001", "9780201633610")
        assert len(populated_members["M001"]["borrowed"]) == 2

    def test_two_members_borrow_same_multi_copy_book(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        borrow_book(populated_members, catalog, "M002", "9780134685991")
        assert catalog["9780134685991"]["available"] == 1

    def test_total_copies_unchanged_after_borrow(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        assert catalog["9780134685991"]["copies"] == 3


# ── return_book ───────────────────────────────────────────────────────────────

class TestReturnBook:

    @pytest.fixture
    def borrowed(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        return populated_members, catalog

    def test_return_removes_isbn_from_borrowed_list(self, borrowed):
        members, catalog = borrowed
        return_book(members, catalog, "M001", "9780134685991")
        assert "9780134685991" not in members["M001"]["borrowed"]

    def test_return_increments_available(self, borrowed):
        members, catalog = borrowed
        before = catalog["9780134685991"]["available"]
        return_book(members, catalog, "M001", "9780134685991")
        assert catalog["9780134685991"]["available"] == before + 1

    def test_return_not_borrowed_raises_value_error(self, populated_members, catalog):
        with pytest.raises(ValueError):
            return_book(populated_members, catalog, "M001", "9780134685991")

    def test_return_unknown_member_raises_key_error(self, borrowed):
        members, catalog = borrowed
        with pytest.raises(KeyError):
            return_book(members, catalog, "UNKNOWN", "9780134685991")

    def test_return_unknown_isbn_raises_key_error(self, borrowed):
        members, catalog = borrowed
        with pytest.raises(KeyError):
            return_book(members, catalog, "M001", "9780000000000")

    def test_return_only_one_occurrence_when_borrowed_twice(self, populated_members, catalog):
        """Borrow same book twice (two copies), return once — one isbn remains."""
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        return_book(populated_members, catalog, "M001", "9780134685991")
        assert populated_members["M001"]["borrowed"].count("9780134685991") == 1

    def test_borrow_return_cycle_restores_available(self, populated_members, catalog):
        original = catalog["9780201633610"]["available"]
        borrow_book(populated_members, catalog, "M001", "9780201633610")
        return_book(populated_members, catalog, "M001", "9780201633610")
        assert catalog["9780201633610"]["available"] == original


# ── get_member_loans ──────────────────────────────────────────────────────────

class TestGetMemberLoans:

    def test_returns_empty_list_for_new_member(self, populated_members, catalog):
        loans = get_member_loans(populated_members, "M001")
        assert loans == []

    def test_returns_borrowed_isbns(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        borrow_book(populated_members, catalog, "M001", "9780201633610")
        loans = get_member_loans(populated_members, "M001")
        assert "9780134685991" in loans
        assert "9780201633610" in loans
        assert len(loans) == 2

    def test_unknown_member_raises_key_error(self, populated_members, catalog):
        with pytest.raises(KeyError):
            get_member_loans(populated_members, "UNKNOWN")

    def test_returns_copy_not_reference(self, populated_members, catalog):
        borrow_book(populated_members, catalog, "M001", "9780134685991")
        loans = get_member_loans(populated_members, "M001")
        loans.clear()
        assert len(populated_members["M001"]["borrowed"]) == 1

    def test_returns_list_type(self, populated_members, catalog):
        result = get_member_loans(populated_members, "M001")
        assert isinstance(result, list)

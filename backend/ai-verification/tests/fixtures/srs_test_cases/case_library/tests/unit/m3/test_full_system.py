"""
tests/unit/m3/test_full_system.py
──────────────────────────────────
Milestone 3 tests — Full system integration.
Covers: overdue_members + end-to-end borrow/return/overdue flows.

Run with:
    pytest tests/unit/m3/ -v
"""

import sys
import os
import pytest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from catalog import add_book, update_copies
from members import (
    register_member,
    borrow_book,
    return_book,
    get_member_loans,
    overdue_members,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def catalog():
    c = {}
    add_book(c, "9780134685991", "Effective Java",   "Joshua Bloch", 3)
    add_book(c, "9780132350884", "Clean Code",        "Robert Martin", 2)
    add_book(c, "9780201633610", "Design Patterns",   "Gang of Four",  2)
    add_book(c, "9780596007126", "Learning Python",   "Mark Lutz",     1)
    return c


@pytest.fixture
def members():
    m = {}
    register_member(m, "M001", "Alice Smith",   "alice@example.com")
    register_member(m, "M002", "Bob Jones",     "bob@example.com")
    register_member(m, "M003", "Carol White",   "carol@example.com")
    return m


NOW = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
YESTERDAY  = NOW - timedelta(days=1)
LAST_WEEK  = NOW - timedelta(days=7)
TOMORROW   = NOW + timedelta(days=1)
NEXT_WEEK  = NOW + timedelta(days=7)


# ── overdue_members ───────────────────────────────────────────────────────────

class TestOverdueMembers:

    def test_no_loans_returns_empty(self, members):
        result = overdue_members(members, {}, NOW)
        assert result == []

    def test_single_overdue_loan(self, members):
        loans = {("M001", "9780134685991"): YESTERDAY}
        result = overdue_members(members, loans, NOW)
        assert "M001" in result

    def test_future_due_date_not_overdue(self, members):
        loans = {("M001", "9780134685991"): TOMORROW}
        result = overdue_members(members, loans, NOW)
        assert result == []

    def test_exactly_at_due_date_not_overdue(self, members):
        loans = {("M001", "9780134685991"): NOW}
        result = overdue_members(members, loans, NOW)
        assert result == []

    def test_multiple_overdue_members(self, members):
        loans = {
            ("M001", "9780134685991"): LAST_WEEK,
            ("M002", "9780132350884"): YESTERDAY,
            ("M003", "9780201633610"): TOMORROW,
        }
        result = overdue_members(members, loans, NOW)
        assert "M001" in result
        assert "M002" in result
        assert "M003" not in result

    def test_deduplication_when_member_has_multiple_overdue_loans(self, members):
        loans = {
            ("M001", "9780134685991"): LAST_WEEK,
            ("M001", "9780132350884"): YESTERDAY,
        }
        result = overdue_members(members, loans, NOW)
        assert result.count("M001") == 1

    def test_returns_sorted_list(self, members):
        loans = {
            ("M003", "9780201633610"): LAST_WEEK,
            ("M001", "9780134685991"): LAST_WEEK,
            ("M002", "9780132350884"): LAST_WEEK,
        }
        result = overdue_members(members, loans, NOW)
        assert result == sorted(result)

    def test_returns_list_type(self, members):
        result = overdue_members(members, {}, NOW)
        assert isinstance(result, list)

    def test_all_loans_future_returns_empty(self, members):
        loans = {
            ("M001", "9780134685991"): TOMORROW,
            ("M002", "9780132350884"): NEXT_WEEK,
        }
        result = overdue_members(members, loans, NOW)
        assert result == []

    def test_mixed_overdue_and_future_for_same_member(self, members):
        loans = {
            ("M001", "9780134685991"): LAST_WEEK,
            ("M001", "9780132350884"): NEXT_WEEK,
        }
        result = overdue_members(members, loans, NOW)
        assert "M001" in result
        assert result.count("M001") == 1


# ── End-to-end integration tests ──────────────────────────────────────────────

class TestEndToEndBorrowReturnFlow:

    def test_full_borrow_return_cycle(self, members, catalog):
        initial_available = catalog["9780134685991"]["available"]
        borrow_book(members, catalog, "M001", "9780134685991")
        assert catalog["9780134685991"]["available"] == initial_available - 1
        assert "9780134685991" in get_member_loans(members, "M001")

        return_book(members, catalog, "M001", "9780134685991")
        assert catalog["9780134685991"]["available"] == initial_available
        assert "9780134685991" not in get_member_loans(members, "M001")

    def test_multiple_members_share_limited_copies(self, members, catalog):
        # Only 1 copy of Learning Python
        borrow_book(members, catalog, "M001", "9780596007126")
        assert catalog["9780596007126"]["available"] == 0

        with pytest.raises(ValueError):
            borrow_book(members, catalog, "M002", "9780596007126")

        return_book(members, catalog, "M001", "9780596007126")
        borrow_book(members, catalog, "M002", "9780596007126")
        assert "9780596007126" in get_member_loans(members, "M002")

    def test_catalog_consistency_after_parallel_borrows(self, members, catalog):
        borrow_book(members, catalog, "M001", "9780132350884")
        borrow_book(members, catalog, "M002", "9780132350884")
        assert catalog["9780132350884"]["available"] == 0

        return_book(members, catalog, "M001", "9780132350884")
        assert catalog["9780132350884"]["available"] == 1

        return_book(members, catalog, "M002", "9780132350884")
        assert catalog["9780132350884"]["available"] == 2

    def test_overdue_detection_after_borrowing(self, members, catalog):
        borrow_book(members, catalog, "M001", "9780134685991")
        borrow_book(members, catalog, "M002", "9780201633610")

        loans = {
            ("M001", "9780134685991"): LAST_WEEK,   # overdue
            ("M002", "9780201633610"): NEXT_WEEK,   # not overdue
        }
        result = overdue_members(members, loans, NOW)
        assert result == ["M001"]

    def test_member_can_borrow_multiple_books(self, members, catalog):
        borrow_book(members, catalog, "M001", "9780134685991")
        borrow_book(members, catalog, "M001", "9780132350884")
        borrow_book(members, catalog, "M001", "9780201633610")
        loans = get_member_loans(members, "M001")
        assert len(loans) == 3

    def test_return_reduces_loan_count(self, members, catalog):
        borrow_book(members, catalog, "M001", "9780134685991")
        borrow_book(members, catalog, "M001", "9780132350884")
        return_book(members, catalog, "M001", "9780134685991")
        loans = get_member_loans(members, "M001")
        assert len(loans) == 1
        assert "9780132350884" in loans

    def test_all_copies_borrowed_then_all_returned(self, members, catalog):
        # Design Patterns has 2 copies
        borrow_book(members, catalog, "M001", "9780201633610")
        borrow_book(members, catalog, "M002", "9780201633610")
        assert catalog["9780201633610"]["available"] == 0

        return_book(members, catalog, "M001", "9780201633610")
        return_book(members, catalog, "M002", "9780201633610")
        assert catalog["9780201633610"]["available"] == 2

    def test_docstrings_exist_on_all_functions(self):
        """All public functions must have docstrings."""
        from catalog import add_book, remove_book, find_by_isbn, find_by_author, update_copies
        from members import register_member, borrow_book, return_book, get_member_loans, overdue_members
        funcs = [
            add_book, remove_book, find_by_isbn, find_by_author, update_copies,
            register_member, borrow_book, return_book, get_member_loans, overdue_members,
        ]
        for fn in funcs:
            assert fn.__doc__ and fn.__doc__.strip(), f"{fn.__name__} is missing a docstring"

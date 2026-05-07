"""
tests/unit/m1/test_catalog.py
──────────────────────────────
Milestone 1 tests — Book catalog CRUD.
Covers: add_book, remove_book, find_by_isbn, find_by_author, update_copies.

Run with:
    pytest tests/unit/m1/ -v
"""

import sys
import os
import pytest

# Allow imports from the project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from catalog import add_book, remove_book, find_by_isbn, find_by_author, update_copies


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def empty_catalog():
    return {}


@pytest.fixture
def catalog_with_books():
    catalog = {}
    add_book(catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
    add_book(catalog, "9780132350884", "Clean Code", "Robert Martin", 2)
    add_book(catalog, "9780201633610", "Design Patterns", "Gang of Four", 1)
    add_book(catalog, "9780596007126", "Learning Python", "Mark Lutz", 4)
    return catalog


# ── add_book ──────────────────────────────────────────────────────────────────

class TestAddBook:

    def test_add_single_book_creates_record(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
        assert "9780134685991" in empty_catalog

    def test_record_has_correct_fields(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
        record = empty_catalog["9780134685991"]
        assert record["title"] == "Effective Java"
        assert record["author"] == "Joshua Bloch"
        assert record["copies"] == 3
        assert record["available"] == 3

    def test_available_equals_copies_on_creation(self, empty_catalog):
        add_book(empty_catalog, "9780132350884", "Clean Code", "Robert Martin", 5)
        assert empty_catalog["9780132350884"]["available"] == 5

    def test_add_multiple_books(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
        add_book(empty_catalog, "9780132350884", "Clean Code", "Robert Martin", 2)
        assert len(empty_catalog) == 2

    def test_duplicate_isbn_raises_value_error(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
        with pytest.raises(ValueError, match="already exists"):
            add_book(empty_catalog, "9780134685991", "Another Book", "Someone", 1)

    def test_zero_copies_raises_value_error(self, empty_catalog):
        with pytest.raises(ValueError):
            add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 0)

    def test_negative_copies_raises_value_error(self, empty_catalog):
        with pytest.raises(ValueError):
            add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", -1)

    def test_empty_title_raises_value_error(self, empty_catalog):
        with pytest.raises(ValueError):
            add_book(empty_catalog, "9780134685991", "", "Joshua Bloch", 1)

    def test_whitespace_title_raises_value_error(self, empty_catalog):
        with pytest.raises(ValueError):
            add_book(empty_catalog, "9780134685991", "   ", "Joshua Bloch", 1)

    def test_empty_author_raises_value_error(self, empty_catalog):
        with pytest.raises(ValueError):
            add_book(empty_catalog, "9780134685991", "Effective Java", "", 1)

    def test_title_is_stripped(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "  Effective Java  ", "Joshua Bloch", 1)
        assert empty_catalog["9780134685991"]["title"] == "Effective Java"

    def test_author_is_stripped(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "  Joshua Bloch  ", 1)
        assert empty_catalog["9780134685991"]["author"] == "Joshua Bloch"

    def test_single_copy(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Effective Java", "Joshua Bloch", 1)
        assert empty_catalog["9780134685991"]["copies"] == 1


# ── remove_book ───────────────────────────────────────────────────────────────

class TestRemoveBook:

    def test_remove_existing_book(self, catalog_with_books):
        record = remove_book(catalog_with_books, "9780134685991")
        assert "9780134685991" not in catalog_with_books
        assert record["title"] == "Effective Java"

    def test_remove_returns_record(self, catalog_with_books):
        record = remove_book(catalog_with_books, "9780132350884")
        assert record["author"] == "Robert Martin"
        assert record["copies"] == 2

    def test_remove_unknown_isbn_raises_key_error(self, catalog_with_books):
        with pytest.raises(KeyError):
            remove_book(catalog_with_books, "9780000000000")

    def test_remove_from_empty_catalog_raises_key_error(self, empty_catalog):
        with pytest.raises(KeyError):
            remove_book(empty_catalog, "9780134685991")

    def test_catalog_size_decreases(self, catalog_with_books):
        before = len(catalog_with_books)
        remove_book(catalog_with_books, "9780134685991")
        assert len(catalog_with_books) == before - 1


# ── find_by_isbn ──────────────────────────────────────────────────────────────

class TestFindByIsbn:

    def test_find_existing_isbn(self, catalog_with_books):
        record = find_by_isbn(catalog_with_books, "9780134685991")
        assert record is not None
        assert record["title"] == "Effective Java"

    def test_find_missing_isbn_returns_none(self, catalog_with_books):
        result = find_by_isbn(catalog_with_books, "9780000000000")
        assert result is None

    def test_find_from_empty_catalog_returns_none(self, empty_catalog):
        assert find_by_isbn(empty_catalog, "9780134685991") is None

    def test_returns_dict_with_expected_keys(self, catalog_with_books):
        record = find_by_isbn(catalog_with_books, "9780134685991")
        assert "title" in record
        assert "author" in record
        assert "copies" in record
        assert "available" in record


# ── find_by_author ────────────────────────────────────────────────────────────

class TestFindByAuthor:

    def test_find_existing_author(self, catalog_with_books):
        results = find_by_author(catalog_with_books, "Joshua Bloch")
        assert len(results) == 1
        assert results[0]["title"] == "Effective Java"

    def test_case_insensitive_match(self, catalog_with_books):
        results_lower = find_by_author(catalog_with_books, "joshua bloch")
        results_upper = find_by_author(catalog_with_books, "JOSHUA BLOCH")
        results_mixed = find_by_author(catalog_with_books, "Joshua Bloch")
        assert len(results_lower) == 1
        assert len(results_upper) == 1
        assert len(results_mixed) == 1

    def test_unknown_author_returns_empty_list(self, catalog_with_books):
        results = find_by_author(catalog_with_books, "Unknown Author")
        assert results == []

    def test_returns_list_type(self, catalog_with_books):
        results = find_by_author(catalog_with_books, "Robert Martin")
        assert isinstance(results, list)

    def test_whitespace_is_stripped_in_search(self, catalog_with_books):
        results = find_by_author(catalog_with_books, "  Joshua Bloch  ")
        assert len(results) == 1


# ── update_copies ─────────────────────────────────────────────────────────────

class TestUpdateCopies:

    def test_decrement_available(self, catalog_with_books):
        before = catalog_with_books["9780134685991"]["available"]
        update_copies(catalog_with_books, "9780134685991", -1)
        assert catalog_with_books["9780134685991"]["available"] == before - 1

    def test_increment_available(self, catalog_with_books):
        update_copies(catalog_with_books, "9780134685991", -1)
        before = catalog_with_books["9780134685991"]["available"]
        update_copies(catalog_with_books, "9780134685991", +1)
        assert catalog_with_books["9780134685991"]["available"] == before + 1

    def test_decrement_to_zero_is_allowed(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Title", "Author", 1)
        update_copies(empty_catalog, "9780134685991", -1)
        assert empty_catalog["9780134685991"]["available"] == 0

    def test_below_zero_raises_value_error(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Title", "Author", 1)
        with pytest.raises(ValueError):
            update_copies(empty_catalog, "9780134685991", -2)

    def test_large_negative_raises_value_error(self, catalog_with_books):
        with pytest.raises(ValueError):
            update_copies(catalog_with_books, "9780134685991", -999)

    def test_unknown_isbn_raises_key_error(self, catalog_with_books):
        with pytest.raises(KeyError):
            update_copies(catalog_with_books, "9780000000000", -1)

    def test_total_copies_unchanged_after_decrement(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Title", "Author", 3)
        update_copies(empty_catalog, "9780134685991", -1)
        assert empty_catalog["9780134685991"]["copies"] == 3

    def test_add_multiple_copies(self, empty_catalog):
        add_book(empty_catalog, "9780134685991", "Title", "Author", 2)
        update_copies(empty_catalog, "9780134685991", +3)
        assert empty_catalog["9780134685991"]["available"] == 5

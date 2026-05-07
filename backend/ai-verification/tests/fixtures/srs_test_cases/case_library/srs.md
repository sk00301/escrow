# Software Requirements Specification (SRS)

## 1. Project Overview

**Project Name:** Library Management System
**Language:** Python 3.x
**Files:** `catalog.py`, `members.py`
**Description:**
A two-module library system. `catalog.py` manages the book inventory.
`members.py` manages member accounts and borrowing transactions.

---

## 2. Module: `catalog.py`

### Function: `add_book(catalog, isbn, title, author, copies)`

**Purpose:** Add a new book to the catalog dict. Raises `ValueError` if
the ISBN already exists or if `copies` is not a positive integer.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| catalog | dict | The in-memory catalog store |
| isbn | str | Unique 13-digit ISBN string |
| title | str | Book title (non-empty) |
| author | str | Author name (non-empty) |
| copies | int | Number of copies (>= 1) |

**Returns:** `None` — mutates `catalog` in place.

**Raises:**
- `ValueError` if ISBN already exists
- `ValueError` if copies < 1
- `ValueError` if title or author is empty

**Examples:**
```python
catalog = {}
add_book(catalog, "9780134685991", "Effective Java", "Joshua Bloch", 3)
# catalog now has one entry
add_book(catalog, "9780134685991", "Dup", "Author", 1)  # raises ValueError
add_book(catalog, "9780000000001", "Title", "Author", 0)  # raises ValueError
```

---

### Function: `remove_book(catalog, isbn)`

**Purpose:** Remove a book from the catalog entirely. Raises `KeyError`
if the ISBN is not found.

**Returns:** The removed book record (dict).

**Raises:**
- `KeyError` if ISBN not in catalog

**Examples:**
```python
remove_book(catalog, "9780134685991")  # returns the record
remove_book(catalog, "9780000000000")  # raises KeyError
```

---

### Function: `find_by_isbn(catalog, isbn)`

**Purpose:** Return the book record for the given ISBN or `None` if not found.

**Returns:** `dict` with keys `title`, `author`, `copies`, `available` — or `None`.

---

### Function: `find_by_author(catalog, author)`

**Purpose:** Return a list of all book records whose `author` field matches
(case-insensitive, strip whitespace). Returns `[]` if none found.

---

### Function: `update_copies(catalog, isbn, delta)`

**Purpose:** Adjust available copy count by `delta` (positive = add copies,
negative = remove copies). Raises `ValueError` if resulting count < 0.
Raises `KeyError` if ISBN not in catalog.

**Examples:**
```python
update_copies(catalog, isbn, -1)  # borrow one copy
update_copies(catalog, isbn, +2)  # return or add copies
update_copies(catalog, isbn, -99) # raises ValueError — not enough copies
```

---

## 3. Module: `members.py`

### Function: `register_member(members, member_id, name, email)`

**Purpose:** Register a new library member. Raises `ValueError` if
`member_id` already exists, email is missing `@`, or name is empty.

**Returns:** `None` — mutates `members` in place.

---

### Function: `borrow_book(members, catalog, member_id, isbn)`

**Purpose:** Record that a member has borrowed a book.
- Decrements available copies via `update_copies`.
- Appends the isbn to the member's `borrowed` list.
- Raises `KeyError` if `member_id` or `isbn` is not found.
- Raises `ValueError` if no copies are available (`available == 0`).

---

### Function: `return_book(members, catalog, member_id, isbn)`

**Purpose:** Record that a member has returned a book.
- Increments available copies via `update_copies`.
- Removes ONE occurrence of isbn from the member's `borrowed` list.
- Raises `KeyError` if member_id or isbn not found.
- Raises `ValueError` if isbn is not in the member's `borrowed` list.

---

### Function: `get_member_loans(members, member_id)`

**Purpose:** Return the list of ISBNs currently borrowed by a member.
Raises `KeyError` if member_id not found.

---

### Function: `overdue_members(members, loans, due_date)`

**Purpose:** Given a `loans` dict mapping `(member_id, isbn)` → `due_datetime`
and a `due_date` datetime object, return a list of `member_id` strings
whose loan due_date is strictly before `due_date`.
Returns `[]` if none are overdue.

---

## 4. Acceptance Criteria (Full)

- All eight functions implemented with correct behaviour
- `ValueError` and `KeyError` raised with correct types (not bare exceptions)
- `find_by_author` is case-insensitive
- `borrow_book` and `return_book` keep the catalog's `available` count consistent
- `overdue_members` returns no duplicates
- All functions have docstrings

---

## 9. Milestone Deliverables

### Milestone 1 — Book catalog CRUD
**Due:** 2026-07-01
**Required functions:** add_book, remove_book, find_by_isbn, find_by_author, update_copies
**Required keywords:** catalog, ISBN, ValueError, KeyError
**Test scope:** pytest tests/unit/m1/
**Acceptance criteria:** Implement the five catalog.py functions. add_book must raise ValueError for duplicate ISBNs and for copies less than 1. remove_book must raise KeyError for unknown ISBNs. find_by_author must be case-insensitive. update_copies must raise ValueError when the result would be negative.

---

### Milestone 2 — Member management and borrowing
**Due:** 2026-07-15
**Required functions:** register_member, borrow_book, return_book, get_member_loans
**Required keywords:** member, borrow, return, available
**Test scope:** pytest tests/unit/m2/
**Acceptance criteria:** Implement the four members.py functions. register_member must reject duplicate member_id and invalid email. borrow_book must raise ValueError when no copies are available and decrement the catalog available count. return_book must raise ValueError when the isbn is not in the member's borrowed list and increment the catalog available count.
**Weight test:** 0.65
**Weight pylint:** 0.25
**Weight flake8:** 0.10

---

### Milestone 3 — Final delivery
**Due:** 2026-08-01
**Required functions:** add_book, remove_book, find_by_isbn, find_by_author, update_copies, register_member, borrow_book, return_book, get_member_loans, overdue_members
**Required keywords:** catalog, ISBN, ValueError, KeyError, member, borrow, return, available, overdue
**Test scope:** pytest tests/
**Acceptance criteria:** All eight functions plus overdue_members fully implemented. borrow_book and return_book keep catalog available counts consistent. overdue_members returns a deduplicated list of member_ids whose loans are past the given due_date. All functions have docstrings.

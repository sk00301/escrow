"""
members.py
──────────
Member account and borrowing management for the Library Management System.

Each member is stored in the members dict under their member_id key:

    members[member_id] = {
        "name":     str,
        "email":    str,
        "borrowed": list[str],   # list of ISBNs currently borrowed
    }
"""

from catalog import update_copies


def register_member(members, member_id, name, email):
    """
    Register a new library member.

    Parameters
    ----------
    members : dict
        In-memory members store (mutated in place).
    member_id : str
        Unique member identifier.
    name : str
        Member's full name (must be non-empty).
    email : str
        Member's email address (must contain '@').

    Raises
    ------
    ValueError
        If member_id already exists, email is invalid, or name is empty.
    """
    if not name or not name.strip():
        raise ValueError("name must not be empty")
    if "@" not in email:
        raise ValueError(f"invalid email address: {email!r}")
    if member_id in members:
        raise ValueError(f"member_id {member_id!r} already registered")

    members[member_id] = {
        "name":     name.strip(),
        "email":    email.strip(),
        "borrowed": [],
    }


def borrow_book(members, catalog, member_id, isbn):
    """
    Record that a member has borrowed a book.

    Decrements the book's available count and appends the isbn to the
    member's borrowed list.

    Parameters
    ----------
    members : dict
        In-memory members store (mutated in place).
    catalog : dict
        In-memory catalog store (mutated in place via update_copies).
    member_id : str
        ID of the borrowing member.
    isbn : str
        ISBN of the book to borrow.

    Raises
    ------
    KeyError
        If member_id or isbn is not found.
    ValueError
        If no copies are available (available == 0).
    """
    if member_id not in members:
        raise KeyError(f"member_id {member_id!r} not found")
    if isbn not in catalog:
        raise KeyError(f"ISBN {isbn!r} not found in catalog")
    if catalog[isbn]["available"] == 0:
        raise ValueError(f"No available copies of ISBN {isbn!r}")

    update_copies(catalog, isbn, -1)
    members[member_id]["borrowed"].append(isbn)


def return_book(members, catalog, member_id, isbn):
    """
    Record that a member has returned a book.

    Increments the book's available count and removes one occurrence of
    isbn from the member's borrowed list.

    Parameters
    ----------
    members : dict
        In-memory members store (mutated in place).
    catalog : dict
        In-memory catalog store (mutated in place via update_copies).
    member_id : str
        ID of the returning member.
    isbn : str
        ISBN of the book being returned.

    Raises
    ------
    KeyError
        If member_id or isbn is not found.
    ValueError
        If the isbn is not in the member's borrowed list.
    """
    if member_id not in members:
        raise KeyError(f"member_id {member_id!r} not found")
    if isbn not in catalog:
        raise KeyError(f"ISBN {isbn!r} not found in catalog")
    if isbn not in members[member_id]["borrowed"]:
        raise ValueError(
            f"ISBN {isbn!r} is not in member {member_id!r}'s borrowed list"
        )

    update_copies(catalog, isbn, +1)
    members[member_id]["borrowed"].remove(isbn)


def get_member_loans(members, member_id):
    """
    Return the list of ISBNs currently borrowed by a member.

    Parameters
    ----------
    members : dict
        In-memory members store.
    member_id : str
        ID of the member.

    Returns
    -------
    list[str]
        ISBNs currently borrowed (may be empty).

    Raises
    ------
    KeyError
        If member_id is not found.
    """
    if member_id not in members:
        raise KeyError(f"member_id {member_id!r} not found")
    return list(members[member_id]["borrowed"])


def overdue_members(members, loans, due_date):
    """
    Return a deduplicated list of member_ids with at least one overdue loan.

    Parameters
    ----------
    members : dict
        In-memory members store.
    loans : dict
        Mapping of (member_id, isbn) -> datetime of loan due date.
    due_date : datetime
        Reference date — loans whose due date is strictly before this are overdue.

    Returns
    -------
    list[str]
        Sorted, deduplicated list of overdue member_ids.
    """
    overdue = set()
    for (member_id, isbn), loan_due in loans.items():
        if loan_due < due_date:
            overdue.add(member_id)
    return sorted(overdue)

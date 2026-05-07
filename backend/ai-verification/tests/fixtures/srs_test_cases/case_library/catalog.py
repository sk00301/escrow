"""
catalog.py
──────────
Book catalog management for the Library Management System.

Each book is stored in the catalog dict under its ISBN key:

    catalog[isbn] = {
        "title":     str,
        "author":    str,
        "copies":    int,   # total copies owned
        "available": int,   # copies not currently borrowed
    }
"""


def add_book(catalog, isbn, title, author, copies):
    """
    Add a new book to the catalog.

    Parameters
    ----------
    catalog : dict
        In-memory catalog store (mutated in place).
    isbn : str
        Unique 13-digit ISBN string.
    title : str
        Book title — must be non-empty.
    author : str
        Author name — must be non-empty.
    copies : int
        Number of copies to add (must be >= 1).

    Raises
    ------
    ValueError
        If the ISBN already exists, copies < 1, or title/author is empty.
    """
    if not title or not title.strip():
        raise ValueError("title must not be empty")
    if not author or not author.strip():
        raise ValueError("author must not be empty")
    if not isinstance(copies, int) or copies < 1:
        raise ValueError(f"copies must be a positive integer, got {copies!r}")
    if isbn in catalog:
        raise ValueError(f"ISBN {isbn!r} already exists in catalog")

    catalog[isbn] = {
        "title":     title.strip(),
        "author":    author.strip(),
        "copies":    copies,
        "available": copies,
    }


def remove_book(catalog, isbn):
    """
    Remove a book from the catalog entirely.

    Parameters
    ----------
    catalog : dict
        In-memory catalog store (mutated in place).
    isbn : str
        ISBN of the book to remove.

    Returns
    -------
    dict
        The removed book record.

    Raises
    ------
    KeyError
        If the ISBN is not in the catalog.
    """
    if isbn not in catalog:
        raise KeyError(f"ISBN {isbn!r} not found in catalog")
    return catalog.pop(isbn)


def find_by_isbn(catalog, isbn):
    """
    Look up a book by ISBN.

    Parameters
    ----------
    catalog : dict
        In-memory catalog store.
    isbn : str
        ISBN to look up.

    Returns
    -------
    dict or None
        The book record, or None if not found.
    """
    return catalog.get(isbn)


def find_by_author(catalog, author):
    """
    Return all books by a given author (case-insensitive match).

    Parameters
    ----------
    catalog : dict
        In-memory catalog store.
    author : str
        Author name to search for.

    Returns
    -------
    list[dict]
        List of matching book records (may be empty).
    """
    needle = author.strip().lower()
    return [
        record for record in catalog.values()
        if record["author"].lower() == needle
    ]


def update_copies(catalog, isbn, delta):
    """
    Adjust the available copy count for a book.

    Parameters
    ----------
    catalog : dict
        In-memory catalog store (mutated in place).
    isbn : str
        ISBN of the book to update.
    delta : int
        Change to apply (positive = add, negative = remove).

    Raises
    ------
    KeyError
        If the ISBN is not in the catalog.
    ValueError
        If the resulting available count would be negative.
    """
    if isbn not in catalog:
        raise KeyError(f"ISBN {isbn!r} not found in catalog")
    new_available = catalog[isbn]["available"] + delta
    if new_available < 0:
        raise ValueError(
            f"Cannot reduce available copies below 0 "
            f"(current={catalog[isbn]['available']}, delta={delta})"
        )
    catalog[isbn]["available"] = new_available

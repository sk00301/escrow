import pytest
from submission import LinkedList


@pytest.fixture
def ll():
    lst = LinkedList()
    for v in [10, 20, 30]:
        lst.insert_at_tail(v)    # BROKEN — list stays empty
    return lst


def test_insert_at_tail(ll):
    assert ll.to_list() == [10, 20, 30]   # FAILS — returns []

def test_insert_at_head():
    lst = LinkedList()
    lst.insert_at_head(5)
    lst.insert_at_head(1)
    assert lst.to_list() == [1, 5]        # FAILS — returns []

def test_search_found(ll):
    assert ll.search(20) is True           # FAILS — empty list

def test_search_not_found(ll):
    assert ll.search(99) is False          # PASSES (empty list → False)

def test_delete_middle(ll):
    ll.delete(20)
    assert ll.to_list() == [10, 30]       # FAILS

def test_delete_head(ll):
    ll.delete(10)
    assert ll.to_list() == [20, 30]       # FAILS

def test_delete_not_found(ll):
    assert ll.delete(99) is False          # PASSES (empty list → False)

def test_delete_returns_true(ll):
    assert ll.delete(30) is True           # FAILS

def test_length(ll):
    assert ll.length() == 3               # FAILS — returns 0

def test_empty_list():
    lst = LinkedList()
    assert lst.to_list() == []            # PASSES

def test_length_after_delete(ll):
    ll.delete(10)
    assert ll.length() == 2              # FAILS — stays 0

def test_insert_tail_empty():
    lst = LinkedList()
    lst.insert_at_tail(7)
    assert lst.to_list() == [7]           # FAILS
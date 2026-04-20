import pytest
from submission import LinkedList

@pytest.fixture
def ll():
    lst = LinkedList()
    for v in [10, 20, 30]:
        lst.insert_at_tail(v)
    return lst

def test_insert_at_tail(ll):
    assert ll.to_list() == [10, 20, 30]

def test_insert_at_head():
    lst = LinkedList()
    lst.insert_at_head(5)
    lst.insert_at_head(1)
    assert lst.to_list() == [1, 5]

def test_search_found(ll):
    assert ll.search(20) is True

def test_search_not_found(ll):
    assert ll.search(99) is False

def test_delete_middle(ll):
    ll.delete(20)
    assert ll.to_list() == [10, 30]

def test_delete_head(ll):
    ll.delete(10)
    assert ll.to_list() == [20, 30]

def test_delete_not_found(ll):
    assert ll.delete(99) is False

def test_delete_returns_true(ll):
    assert ll.delete(30) is True

def test_length(ll):
    assert ll.length() == 3

def test_empty_list():
    lst = LinkedList()
    assert lst.to_list() == []

def test_length_after_delete(ll):
    ll.delete(10)
    assert ll.length() == 2

def test_insert_tail_empty():
    lst = LinkedList()
    lst.insert_at_tail(7)
    assert lst.to_list() == [7]

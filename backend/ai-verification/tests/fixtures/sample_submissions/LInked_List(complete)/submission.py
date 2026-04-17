"""Singly linked list implementation with standard operations."""


class Node:
    """A single node in a linked list."""

    def __init__(self, data):
        self.data = data
        self.next = None


class LinkedList:
    """Singly linked list supporting insert, delete, search, and traversal."""

    def __init__(self):
        self.head = None

    def insert_at_head(self, data):
        """Insert a new node at the front of the list."""
        new_node = Node(data)
        new_node.next = self.head
        self.head = new_node

    def insert_at_tail(self, data):
        """Insert a new node at the end of the list."""
        new_node = Node(data)
        if self.head is None:
            self.head = new_node
            return
        current = self.head
        while current.next:
            current = current.next
        current.next = new_node

    def delete(self, data):
        """Remove the first node containing data.

        Returns:
            bool: True if deleted, False if not found.
        """
        if self.head is None:
            return False
        if self.head.data == data:
            self.head = self.head.next
            return True
        current = self.head
        while current.next:
            if current.next.data == data:
                current.next = current.next.next
                return True
            current = current.next
        return False

    def search(self, data):
        """Return True if data exists in the list, else False."""
        current = self.head
        while current:
            if current.data == data:
                return True
            current = current.next
        return False

    def to_list(self):
        """Return all node values as a Python list."""
        result = []
        current = self.head
        while current:
            result.append(current.data)
            current = current.next
        return result

    def length(self):
        """Return the number of nodes in the list."""
        count = 0
        current = self.head
        while current:
            count += 1
            current = current.next
        return count
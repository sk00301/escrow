"""Linked list — delete works, search is broken (always returns False)."""


class Node:
    def __init__(self, data):
        self.data = data
        self.next = None


class LinkedList:
    def __init__(self):
        self.head = None

    def insert_at_head(self, data):
        new_node = Node(data)
        new_node.next = self.head
        self.head = new_node

    def insert_at_tail(self, data):
        new_node = Node(data)
        if self.head is None:
            self.head = new_node
            return
        current = self.head
        while current.next:
            current = current.next
        current.next = new_node

    def delete(self, data):
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
        # BUG: loop variable shadows 'current', never traverses list properly
        current = self.head
        while current:
            current = current.next     # advances BEFORE checking — skips head
            if current and current.data == data:
                return True
        return False                   # always False for head-stored values

    def to_list(self):
        result = []
        current = self.head
        while current:
            result.append(current.data)
            current = current.next
        return result

    def length(self):
        count = 0
        current = self.head
        while current:
            count += 1
            current = current.next
        return count
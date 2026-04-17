"""Bank account — missing almost all error handling."""


class BankAccount:

    def __init__(self, owner, initial_balance=0.0):
        # BUG: no validation on initial_balance
        self.owner = owner
        self._balance = initial_balance

    @property
    def balance(self):
        return self._balance

    def deposit(self, amount):
        # BUG: no validation — accepts negatives, zero, anything
        self._balance += amount

    def withdraw(self, amount):
        # BUG: no validation — accepts negatives, allows overdraft
        self._balance -= amount

    def transaction_count(self):
        # BUG: no transaction tracking — always returns 0
        return 0
"""Bank account — negative balances allowed (overdraft not guarded)."""


class BankAccount:

    def __init__(self, owner, initial_balance=0.0):
        if initial_balance < 0:
            raise ValueError("Initial balance cannot be negative.")
        self.owner = owner
        self._balance = initial_balance
        self._transactions = []

    @property
    def balance(self):
        return self._balance

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("Deposit amount must be positive.")
        self._balance += amount
        self._transactions.append(("deposit", amount))
        return self._balance

    def withdraw(self, amount):
        if amount <= 0:
            raise ValueError("Withdrawal amount must be positive.")
        # BUG: no insufficient funds check — allows negative balance
        self._balance -= amount
        self._transactions.append(("withdraw", amount))
        return self._balance

    def transaction_count(self):
        return len(self._transactions)
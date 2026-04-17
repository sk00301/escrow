"""Bank account class with deposit, withdraw, and balance tracking."""


class BankAccount:
    """Simple bank account with transaction history."""

    def __init__(self, owner, initial_balance=0.0):
        """Initialise account.

        Args:
            owner (str): Account holder name.
            initial_balance (float): Starting balance, must be non-negative.

        Raises:
            ValueError: If initial_balance is negative.
        """
        if initial_balance < 0:
            raise ValueError("Initial balance cannot be negative.")
        self.owner = owner
        self._balance = initial_balance
        self._transactions = []

    @property
    def balance(self):
        """Current account balance."""
        return self._balance

    def deposit(self, amount):
        """Deposit a positive amount into the account.

        Raises:
            ValueError: If amount is not positive.
        """
        if amount <= 0:
            raise ValueError("Deposit amount must be positive.")
        self._balance += amount
        self._transactions.append(("deposit", amount))
        return self._balance

    def withdraw(self, amount):
        """Withdraw amount from account if sufficient funds exist.

        Raises:
            ValueError: If amount is not positive or exceeds balance.
        """
        if amount <= 0:
            raise ValueError("Withdrawal amount must be positive.")
        if amount > self._balance:
            raise ValueError("Insufficient funds.")
        self._balance -= amount
        self._transactions.append(("withdraw", amount))
        return self._balance

    def transaction_count(self):
        """Return total number of transactions."""
        return len(self._transactions)
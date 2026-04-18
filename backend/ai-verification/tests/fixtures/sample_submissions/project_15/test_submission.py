import pytest
from submission import BankAccount


@pytest.fixture
def account():
    return BankAccount("Alice", 100.0)


def test_initial_balance(account):
    assert account.balance == 100.0         # PASSES

def test_deposit(account):
    account.deposit(50)
    assert account.balance == 150.0         # PASSES

def test_withdraw(account):
    account.withdraw(30)
    assert account.balance == 70.0          # PASSES

def test_overdraft_raises(account):
    with pytest.raises(ValueError):
        account.withdraw(200)               # FAILS — no guard

def test_negative_deposit_raises(account):
    with pytest.raises(ValueError):
        account.deposit(-10)                # FAILS — no guard

def test_zero_deposit_raises(account):
    with pytest.raises(ValueError):
        account.deposit(0)                  # FAILS — no guard

def test_negative_withdraw_raises(account):
    with pytest.raises(ValueError):
        account.withdraw(-5)                # FAILS — no guard

def test_negative_initial_raises():
    with pytest.raises(ValueError):
        BankAccount("Bob", -50)             # FAILS — no validation in __init__

def test_transaction_count(account):
    account.deposit(10)
    account.withdraw(5)
    assert account.transaction_count() == 2  # FAILS — always returns 0
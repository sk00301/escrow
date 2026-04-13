"""conftest.py — ensures the src/ package is importable during test runs."""
import sys
from pathlib import Path

# Add the calculator root to sys.path so `from src.calculator import ...` works
sys.path.insert(0, str(Path(__file__).parent))

import sys
from pathlib import Path

# Add the project root to sys.path so `from app.x import y` and `from main import app` work
sys.path.insert(0, str(Path(__file__).parent))

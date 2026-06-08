import sys
from pathlib import Path

# Add understand-business skills directory to sys.path so test modules can import them.
_BUSINESS_SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'
sys.path.insert(0, str(_BUSINESS_SKILLS_DIR))

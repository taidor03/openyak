"""Wiki Knowledge Center — shared constants.

This module exists to break circular imports: ``service.py``,
``graph.py``, and ``lint.py`` all need ``DEFAULT_CATEGORIES``,
but ``service.py`` imports ``graph.py`` at module level.
Placing the constant here avoids the cycle.
"""

# Default category subdirectories created on init
DEFAULT_CATEGORIES = [
    "entities",
    "concepts",
    "sources",
    "synthesis",
    "comparison",
    "queries",
]

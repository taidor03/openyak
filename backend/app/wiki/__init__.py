"""Wiki Knowledge Center — native Python implementation.

Provides a self-contained Wiki system that can be used by the LLM via the
``wiki`` tool, without requiring an external MCP daemon.

Wiki root resolution:
  - Project session → ``{workspace}/.wiki``
  - Global session  → ``~/.xflow/wiki``

Core algorithms ported from nashsu/llm_wiki (TypeScript), adapted to Python
with the following changes:
  - No Tauri IPC / FileNode tree — uses pathlib directly
  - No vector/embedding search — pure token search + scoring
  - No RRF fusion — single-list ranking (simpler, sufficient for V1)
"""

from app.wiki.service import WikiService

__all__ = ["WikiService"]

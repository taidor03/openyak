"""Wiki Review Items — Convert lint results into actionable review items.

Ported from nashsu/llm_wiki ``src/lib/lint.ts`` and ``src/components/review/review-view.tsx``,
adapted for xflow architecture (no Tauri IPC, Python backend).

Each review item is an actionable unit that the user can:
- Approve (create missing page / add link / update content)
- Skip (dismiss as not important)
- Resolve (mark as handled)
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ReviewItem:
    """A single actionable review item."""

    id: str
    type: str  # broken-link, orphan, stale, empty-category, contradiction, missing-page, suggestion
    severity: str  # warning, info
    title: str
    description: str
    affected_pages: list[str] = field(default_factory=list)
    suggested_action: str = ""  # create-page, add-link, update-content, review-manually
    status: str = "open"  # open, resolved, skipped
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    resolved_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ReviewStore:
    """Persistent store for review items, per wiki root.

    Uses a JSON file (``{wiki_root}/.review.json``) for persistence.
    """

    def __init__(self, wiki_root: str) -> None:
        self.wiki_root = wiki_root
        self._path = Path(wiki_root) / ".review.json"
        self._items: dict[str, ReviewItem] = {}
        self._load()

    # -- persistence --

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                for item_data in data.get("items", []):
                    item = ReviewItem(
                        id=item_data["id"],
                        type=item_data["type"],
                        severity=item_data["severity"],
                        title=item_data["title"],
                        description=item_data.get("description", ""),
                        affected_pages=item_data.get("affected_pages", []),
                        suggested_action=item_data.get("suggested_action", ""),
                        status=item_data.get("status", "open"),
                        created_at=item_data.get("created_at", datetime.now().isoformat()),
                        resolved_at=item_data.get("resolved_at"),
                    )
                    self._items[item.id] = item
            except (json.JSONDecodeError, KeyError) as exc:
                logger.warning("Failed to load review store: %s", exc)
                self._items = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "items": [item.to_dict() for item in self._items.values()],
            "updated_at": datetime.now().isoformat(),
        }
        self._path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # -- CRUD --

    def add_item(self, item: ReviewItem) -> None:
        self._items[item.id] = item
        self._save()

    def get_item(self, item_id: str) -> ReviewItem | None:
        return self._items.get(item_id)

    def resolve_item(self, item_id: str) -> bool:
        item = self._items.get(item_id)
        if item is None:
            return False
        item.status = "resolved"
        item.resolved_at = datetime.now().isoformat()
        self._save()
        return True

    def skip_item(self, item_id: str) -> bool:
        item = self._items.get(item_id)
        if item is None:
            return False
        item.status = "skipped"
        self._save()
        return True

    def list_items(self, status: str | None = None) -> list[ReviewItem]:
        items = list(self._items.values())
        if status:
            items = [i for i in items if i.status == status]
        return sorted(items, key=lambda i: (0 if i.severity == "warning" else 1, i.created_at))

    def clear_resolved(self) -> int:
        """Remove all resolved/skipped items. Returns count removed."""
        before = len(self._items)
        self._items = {k: v for k, v in self._items.items() if v.status == "open"}
        removed = before - len(self._items)
        if removed:
            self._save()
        return removed


def generate_review_items_from_lint(
    wiki_root: str,
    lint_result: dict[str, Any],
) -> list[ReviewItem]:
    """Generate ReviewItems from a lint scan result.

    Maps each lint issue type to an actionable review item with a
    suggested action.
    """
    items: list[ReviewItem] = []
    issues = lint_result.get("issues", [])

    for issue in issues:
        issue_type = issue.get("type", "unknown")
        severity = issue.get("severity", "info")
        page_id = issue.get("page_id", "")
        message = issue.get("message", "")

        if issue_type == "broken-link":
            # The wikilink target is embedded in the message
            target = message.replace("Broken wikilink to", "").strip().strip("'\"")
            items.append(ReviewItem(
                id=f"bl-{uuid.uuid4().hex[:8]}",
                type="broken-link",
                severity=severity,
                title=f"Broken link: [[{target}]]",
                description=f"Page '{page_id}' contains a link to '{target}' which does not exist.",
                affected_pages=[page_id],
                suggested_action="create-page",
            ))

        elif issue_type == "orphan":
            items.append(ReviewItem(
                id=f"or-{uuid.uuid4().hex[:8]}",
                type="orphan",
                severity=severity,
                title=f"Orphan page: {page_id}",
                description=f"Page '{page_id}' has no incoming links from other wiki pages.",
                affected_pages=[page_id],
                suggested_action="add-link",
            ))

        elif issue_type == "stale":
            days = issue.get("days_old", "?")
            items.append(ReviewItem(
                id=f"st-{uuid.uuid4().hex[:8]}",
                type="stale",
                severity=severity,
                title=f"Stale page: {page_id}",
                description=f"Page '{page_id}' has not been updated for {days} days.",
                affected_pages=[page_id],
                suggested_action="update-content",
            ))

        elif issue_type == "no-outlinks":
            items.append(ReviewItem(
                id=f"no-{uuid.uuid4().hex[:8]}",
                type="orphan",
                severity=severity,
                title=f"No outgoing links: {page_id}",
                description=f"Page '{page_id}' does not link to any other wiki pages.",
                affected_pages=[page_id],
                suggested_action="add-link",
            ))

        elif issue_type == "empty-category":
            category = issue.get("category", "")
            items.append(ReviewItem(
                id=f"ec-{uuid.uuid4().hex[:8]}",
                type="empty-category",
                severity=severity,
                title=f"Empty category: {category}",
                description=f"Category '{category}' has no pages.",
                affected_pages=[],
                suggested_action="review-manually",
            ))

        elif issue_type == "contradiction":
            pages = issue.get("pages", [])
            items.append(ReviewItem(
                id=f"ct-{uuid.uuid4().hex[:8]}",
                type="contradiction",
                severity="warning",
                title=f"Contradiction: {message}",
                description=message,
                affected_pages=pages,
                suggested_action="review-manually",
            ))

        elif issue_type == "suggestion":
            items.append(ReviewItem(
                id=f"sg-{uuid.uuid4().hex[:8]}",
                type="suggestion",
                severity=severity,
                title=f"Suggestion: {message}",
                description=message,
                affected_pages=[page_id] if page_id else [],
                suggested_action="review-manually",
            ))

        else:
            # Generic fallback
            items.append(ReviewItem(
                id=f"gn-{uuid.uuid4().hex[:8]}",
                type=issue_type,
                severity=severity,
                title=f"{issue_type}: {message}",
                description=message,
                affected_pages=[page_id] if page_id else [],
                suggested_action="review-manually",
            ))

    return items

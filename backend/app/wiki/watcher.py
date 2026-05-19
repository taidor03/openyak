"""File system watcher for automatic wiki ingestion.

Monitors a workspace directory for new/modified/deleted files and
automatically triggers wiki ingestion or cleanup.

Uses ``watchfiles`` for efficient file system monitoring.  Falls back
to a polling-based approach if ``watchfiles`` is not available.

Ported from nashsu/llm_wiki ``src/lib/watcher.ts``, adapted for Python.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

# Supported file extensions for auto-ingest
_WATCHED_EXTENSIONS = {".md", ".txt", ".json", ".csv", ".yaml", ".yml", ".toml"}

# Directories to ignore
_IGNORE_DIRS = {".git", ".wiki", "node_modules", "__pycache__", ".venv", "venv", ".idea", ".vscode"}

# Debounce interval (seconds) — wait this long after last change before processing
_DEBOUNCE_SECONDS = 2.0


@dataclass
class WatcherEvent:
    """A file system event detected by the watcher."""

    event_type: str  # "created", "modified", "deleted"
    file_path: str
    timestamp: float = field(default_factory=time.monotonic)


@dataclass
class WatcherStatus:
    """Current status of the file watcher."""

    running: bool = False
    watched_dir: str = ""
    events_processed: int = 0
    last_event_time: float = 0.0
    errors: int = 0
    started_at: float = 0.0


class WikiWatcher:
    """File system watcher for automatic wiki ingestion.

    Monitors a workspace directory and triggers:
    - ``on_new_file`` when a new supported file is detected → enqueue for ingestion
    - ``on_modified_file`` when a file is modified → mark corresponding wiki page as stale
    - ``on_deleted_file`` when a file is deleted → trigger cascade cleanup

    Usage::

        watcher = WikiWatcher(workspace_dir="/path/to/project")
        watcher.set_callbacks(
            on_new_file=my_ingest_handler,
            on_modified_file=my_stale_handler,
            on_deleted_file=my_cleanup_handler,
        )
        await watcher.start()
        # ... later ...
        await watcher.stop()
    """

    def __init__(self, workspace_dir: str, wiki_root: str | None = None) -> None:
        self.workspace_dir = workspace_dir
        self.wiki_root = wiki_root
        self._status = WatcherStatus(watched_dir=workspace_dir)
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

        # Callbacks
        self._on_new_file: Callable[[str], Coroutine] | None = None
        self._on_modified_file: Callable[[str], Coroutine] | None = None
        self._on_deleted_file: Callable[[str], Coroutine] | None = None

    def set_callbacks(
        self,
        *,
        on_new_file: Callable[[str], Coroutine] | None = None,
        on_modified_file: Callable[[str], Coroutine] | None = None,
        on_deleted_file: Callable[[str], Coroutine] | None = None,
    ) -> None:
        """Set async callbacks for file events."""
        self._on_new_file = on_new_file
        self._on_modified_file = on_modified_file
        self._on_deleted_file = on_deleted_file

    @property
    def status(self) -> dict[str, Any]:
        """Return current watcher status as a dict."""
        s = self._status
        uptime = time.monotonic() - s.started_at if s.running else 0.0
        return {
            "running": s.running,
            "watched_dir": s.watched_dir,
            "events_processed": s.events_processed,
            "last_event_time": s.last_event_time,
            "errors": s.errors,
            "uptime_seconds": round(uptime, 1),
        }

    async def start(self) -> bool:
        """Start watching the workspace directory.

        Returns True if started successfully, False otherwise.
        """
        if self._status.running:
            logger.warning("Watcher already running for %s", self.workspace_dir)
            return False

        workspace = Path(self.workspace_dir)
        if not workspace.is_dir():
            logger.error("Workspace directory does not exist: %s", self.workspace_dir)
            return False

        self._stop_event.clear()
        self._status.running = True
        self._status.started_at = time.monotonic()

        try:
            self._task = asyncio.create_task(self._watch_loop())
            logger.info("Watcher started for %s", self.workspace_dir)
            return True
        except Exception as exc:
            logger.error("Failed to start watcher: %s", exc)
            self._status.running = False
            return False

    async def stop(self) -> None:
        """Stop the watcher."""
        if not self._status.running:
            return

        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        self._status.running = False
        self._task = None
        logger.info("Watcher stopped for %s", self.workspace_dir)

    async def _watch_loop(self) -> None:
        """Main watch loop using watchfiles or polling fallback."""
        try:
            import watchfiles  # noqa: F401

            await self._watch_with_watchfiles()
        except ImportError:
            logger.info("watchfiles not available, using polling fallback")
            await self._watch_with_polling()

    async def _watch_with_watchfiles(self) -> None:
        """Watch using the watchfiles library (efficient native file watching)."""
        from watchfiles import awatch, Change

        workspace = Path(self.workspace_dir)

        try:
            async for changes in awatch(
                workspace,
                stop_event=self._stop_event,
                watch_filter=self._filter_event,
            ):
                if self._stop_event.is_set():
                    break

                await self._process_changes(changes)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Watcher error: %s", exc)
            self._status.errors += 1

    async def _watch_with_polling(self) -> None:
        """Fallback: poll the directory for changes every 5 seconds."""
        workspace = Path(self.workspace_dir)
        known_files: dict[str, float] = {}  # path -> mtime

        # Initial scan
        for root, dirs, files in os.walk(workspace):
            dirs[:] = [d for d in dirs if d not in _IGNORE_DIRS]
            for fname in files:
                fpath = os.path.join(root, fname)
                if Path(fname).suffix.lower() not in _WATCHED_EXTENSIONS:
                    continue
                try:
                    known_files[fpath] = os.path.getmtime(fpath)
                except OSError:
                    pass

        while not self._stop_event.is_set():
            try:
                await asyncio.sleep(5.0)
                if self._stop_event.is_set():
                    break

                current_files: dict[str, float] = {}
                for root, dirs, files in os.walk(workspace):
                    dirs[:] = [d for d in dirs if d not in _IGNORE_DIRS]
                    for fname in files:
                        fpath = os.path.join(root, fname)
                        if Path(fname).suffix.lower() not in _WATCHED_EXTENSIONS:
                            continue
                        try:
                            current_files[fpath] = os.path.getmtime(fpath)
                        except OSError:
                            pass

                changes: list[tuple[int, str]] = []

                # Detect new and modified files
                for fpath, mtime in current_files.items():
                    if fpath not in known_files:
                        changes.append((1, fpath))  # 1 = created
                    elif mtime > known_files[fpath]:
                        changes.append((2, fpath))  # 2 = modified

                # Detect deleted files
                for fpath in known_files:
                    if fpath not in current_files:
                        changes.append((3, fpath))  # 3 = deleted

                if changes:
                    await self._process_changes(changes)

                known_files = current_files

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Polling watcher error: %s", exc)
                self._status.errors += 1

    def _filter_event(self, change_type: Any, path: str) -> bool:
        """Filter watchfiles events to only include relevant files."""
        from watchfiles import Change

        # Skip ignored directories
        parts = Path(path).parts
        for part in parts:
            if part in _IGNORE_DIRS:
                return False

        # Only watch supported file extensions
        ext = Path(path).suffix.lower()
        if ext not in _WATCHED_EXTENSIONS:
            return False

        # Skip files inside .wiki directory
        if ".wiki" in str(path):
            return False

        return True

    async def _process_changes(self, changes: Any) -> None:
        """Process a batch of file changes."""
        from watchfiles import Change

        debounce_map: dict[str, tuple[int, str]] = {}  # path -> (change_type_int, path)

        for change in changes:
            if isinstance(change, tuple) and len(change) == 2:
                change_type_val, path = change
            else:
                continue

            # Map change type
            if hasattr(Change, "added") and isinstance(change_type_val, Change):
                if change_type_val == Change.added:
                    cint = 1
                elif change_type_val == Change.modified:
                    cint = 2
                elif change_type_val == Change.deleted:
                    cint = 3
                else:
                    continue
            else:
                cint = change_type_val

            # Debounce: for the same file, keep the most recent change type
            # Priority: deleted > created > modified
            existing = debounce_map.get(path)
            if existing is None:
                debounce_map[path] = (cint, path)
            elif cint == 3:  # deleted always wins
                debounce_map[path] = (cint, path)
            elif cint == 1 and existing[0] != 3:  # created overwrites modified
                debounce_map[path] = (cint, path)

        # Process debounced changes
        for (cint, path) in debounce_map.values():
            try:
                if cint == 1:  # created
                    await self._handle_new_file(path)
                elif cint == 2:  # modified
                    await self._handle_modified_file(path)
                elif cint == 3:  # deleted
                    await self._handle_deleted_file(path)

                self._status.events_processed += 1
                self._status.last_event_time = time.monotonic()
            except Exception as exc:
                logger.error("Error processing file event for %s: %s", path, exc)
                self._status.errors += 1

    async def _handle_new_file(self, file_path: str) -> None:
        """Handle a newly created file — enqueue for ingestion."""
        logger.info("New file detected: %s", file_path)
        if self._on_new_file:
            try:
                await self._on_new_file(file_path)
            except Exception as exc:
                logger.error("on_new_file callback failed for %s: %s", file_path, exc)

    async def _handle_modified_file(self, file_path: str) -> None:
        """Handle a modified file — mark corresponding wiki page as stale."""
        logger.info("File modified: %s", file_path)
        if self._on_modified_file:
            try:
                await self._on_modified_file(file_path)
            except Exception as exc:
                logger.error("on_modified_file callback failed for %s: %s", file_path, exc)

    async def _handle_deleted_file(self, file_path: str) -> None:
        """Handle a deleted file — trigger cascade cleanup."""
        logger.info("File deleted: %s", file_path)
        if self._on_deleted_file:
            try:
                await self._on_deleted_file(file_path)
            except Exception as exc:
                logger.error("on_deleted_file callback failed for %s: %s", file_path, exc)


# ── Module-level watcher management ──────────────────────────────────────────

_active_watchers: dict[str, WikiWatcher] = {}


async def start_watcher(
    workspace_dir: str,
    wiki_root: str | None = None,
) -> dict[str, Any]:
    """Start a file watcher for the given workspace.

    Returns the watcher status dict.
    """
    # Stop existing watcher for this workspace
    if workspace_dir in _active_watchers:
        await _active_watchers[workspace_dir].stop()

    watcher = WikiWatcher(workspace_dir, wiki_root=wiki_root)

    # Set up default callbacks that interact with WikiService
    async def on_new_file(path: str) -> None:
        """Enqueue new file for wiki ingestion."""
        try:
            from app.wiki.service import WikiService

            content = Path(path).read_text(encoding="utf-8", errors="replace")
            source_name = Path(path).stem
            root = wiki_root or WikiService.resolve_wiki_root(workspace_dir)
            if root:
                await WikiService.enqueue_ingest(root, source_name, content)
        except Exception as exc:
            logger.error("Auto-ingest failed for %s: %s", path, exc)

    async def on_modified_file(path: str) -> None:
        """Mark corresponding wiki page as stale (update its frontmatter)."""
        # For now, just log it — the review sweep will pick it up
        logger.info("File modified, consider running review-sweep: %s", path)

    async def on_deleted_file(path: str) -> None:
        """No-op for now — cascade delete would need page_id mapping."""
        logger.info("Source file deleted: %s", path)

    watcher.set_callbacks(
        on_new_file=on_new_file,
        on_modified_file=on_modified_file,
        on_deleted_file=on_deleted_file,
    )

    success = await watcher.start()
    if success:
        _active_watchers[workspace_dir] = watcher

    return watcher.status


async def stop_watcher(workspace_dir: str) -> dict[str, Any]:
    """Stop the watcher for the given workspace."""
    watcher = _active_watchers.pop(workspace_dir, None)
    if watcher:
        await watcher.stop()
        return {"stopped": True, "watched_dir": workspace_dir}
    return {"stopped": False, "watched_dir": workspace_dir, "message": "No active watcher"}


def get_watcher_status(workspace_dir: str) -> dict[str, Any]:
    """Get the status of the watcher for the given workspace."""
    watcher = _active_watchers.get(workspace_dir)
    if watcher:
        return watcher.status
    return {"running": False, "watched_dir": workspace_dir}


def get_all_watcher_statuses() -> dict[str, dict[str, Any]]:
    """Get status of all active watchers."""
    return {ws: w.status for ws, w in _active_watchers.items()}

"""Persistent Ingest Queue — project-isolated, auto-retry on failure.

Ported from nashsu/llm_wiki ``src/lib/ingest-queue.ts``, adapted for
Python backend (no Tauri IPC).

Queue is stored as a JSON file (``{wiki_root}/.ingest-queue.json``) per
wiki root, enabling project isolation and persistence across restarts.
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

MAX_RETRIES = 3


@dataclass
class IngestJob:
    """A single ingest job in the queue."""

    id: str
    source_name: str
    content: str
    purpose: str = "general"
    status: str = "pending"  # pending, processing, done, failed
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    retries: int = 0
    result: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class IngestQueue:
    """Persistent queue for ingest jobs, isolated per wiki root.

    Uses a JSON file for persistence (``{wiki_root}/.ingest-queue.json``).
    """

    def __init__(self, wiki_root: str) -> None:
        self.wiki_root = wiki_root
        self._path = Path(wiki_root) / ".ingest-queue.json"
        self._jobs: dict[str, IngestJob] = {}
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                for job_data in data.get("jobs", []):
                    job = IngestJob(
                        id=job_data["id"],
                        source_name=job_data["source_name"],
                        content=job_data.get("content", ""),
                        purpose=job_data.get("purpose", "general"),
                        status=job_data.get("status", "pending"),
                        created_at=job_data.get("created_at", datetime.now().isoformat()),
                        started_at=job_data.get("started_at"),
                        finished_at=job_data.get("finished_at"),
                        error=job_data.get("error"),
                        retries=job_data.get("retries", 0),
                        result=job_data.get("result"),
                    )
                    self._jobs[job.id] = job
            except (json.JSONDecodeError, KeyError) as exc:
                logger.warning("Failed to load ingest queue: %s", exc)
                self._jobs = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "jobs": [job.to_dict() for job in self._jobs.values()],
            "updated_at": datetime.now().isoformat(),
        }
        self._path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def enqueue(
        self,
        source_name: str,
        content: str,
        purpose: str = "general",
    ) -> IngestJob:
        """Add a new ingest job to the queue.

        Deduplication: if a pending/processing job with the same
        ``source_name`` already exists, that existing job is returned
        instead of creating a duplicate (upsert semantics, ported from
        llm_wiki ``upsertQueuedIngestTask``).
        """
        # Dedup: return existing pending/processing job for same source
        for existing_job in self._jobs.values():
            if (
                existing_job.source_name == source_name
                and existing_job.status in ("pending", "processing")
            ):
                logger.debug(
                    "Dedup: returning existing job %s for source '%s'",
                    existing_job.id, source_name,
                )
                return existing_job

        job = IngestJob(
            id=f"ij-{uuid.uuid4().hex[:8]}",
            source_name=source_name,
            content=content,
            purpose=purpose,
        )
        self._jobs[job.id] = job
        self._save()
        return job

    def enqueue_batch(
        self,
        items: list[dict[str, Any]],
    ) -> list[IngestJob]:
        """Add multiple ingest jobs at once.

        Each item dict should have keys: source_name, content, purpose (optional).
        Deduplication is applied per item (same as ``enqueue``).

        Ported from llm_wiki ``enqueueBatch``.
        """
        jobs: list[IngestJob] = []
        for item in items:
            job = self.enqueue(
                source_name=item["source_name"],
                content=item.get("content", ""),
                purpose=item.get("purpose", "general"),
            )
            jobs.append(job)
        return jobs

    def dequeue(self) -> IngestJob | None:
        """Get the next pending job and mark it as processing."""
        for job in self._jobs.values():
            if job.status == "pending":
                job.status = "processing"
                job.started_at = datetime.now().isoformat()
                self._save()
                return job
        return None

    def mark_done(self, job_id: str, result: dict[str, Any] | None = None) -> bool:
        """Mark a job as successfully completed."""
        job = self._jobs.get(job_id)
        if job is None:
            return False
        job.status = "done"
        job.finished_at = datetime.now().isoformat()
        job.result = result
        self._save()
        return True

    def mark_failed(self, job_id: str, error: str) -> bool:
        """Mark a job as failed. If retries < MAX_RETRIES, reset to pending."""
        job = self._jobs.get(job_id)
        if job is None:
            return False
        job.retries += 1
        if job.retries < MAX_RETRIES:
            job.status = "pending"
            job.error = error
            logger.info(
                "Job %s failed (retry %d/%d): %s",
                job_id, job.retries, MAX_RETRIES, error,
            )
        else:
            job.status = "failed"
            job.error = error
            job.finished_at = datetime.now().isoformat()
            logger.warning("Job %s permanently failed after %d retries: %s", job_id, MAX_RETRIES, error)
        self._save()
        return True

    def retry_failed(self, job_id: str) -> bool:
        """Manually retry a failed job."""
        job = self._jobs.get(job_id)
        if job is None or job.status != "failed":
            return False
        job.status = "pending"
        job.retries = 0
        job.error = None
        job.finished_at = None
        self._save()
        return True

    def list_jobs(self, status: str | None = None) -> list[IngestJob]:
        """List all jobs, optionally filtered by status."""
        jobs = list(self._jobs.values())
        if status:
            jobs = [j for j in jobs if j.status == status]
        return sorted(jobs, key=lambda j: j.created_at)

    def get_job(self, job_id: str) -> IngestJob | None:
        """Get a specific job by ID."""
        return self._jobs.get(job_id)

    def clear_done(self) -> int:
        """Remove completed jobs. Returns count removed."""
        before = len(self._jobs)
        self._jobs = {k: v for k, v in self._jobs.items() if v.status != "done"}
        removed = before - len(self._jobs)
        if removed:
            self._save()
        return removed

    def is_drained(self) -> bool:
        """Check if all pending jobs have been processed.

        A queue is "drained" when there are no pending or processing jobs.
        Useful for triggering callbacks (ported from llm_wiki queue-drain).
        """
        return all(j.status in ("done", "failed") for j in self._jobs.values())

    @property
    def stats(self) -> dict[str, int]:
        """Return queue statistics."""
        counts: dict[str, int] = {"pending": 0, "processing": 0, "done": 0, "failed": 0}
        for job in self._jobs.values():
            counts[job.status] = counts.get(job.status, 0) + 1
        return counts

"""Message listing endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_db, get_session_factory
from app.models.message import Message
from app.schemas.message import MessageResponse, PaginatedMessages, PartResponse
from app.session.manager import count_messages, get_messages

logger = logging.getLogger(__name__)
router = APIRouter()


def _sanitize_orphan_running_parts(parts: list) -> list[tuple]:
    """Fix orphan tool parts stuck in 'running' status.

    When a generation is interrupted (e.g., by loop-detection forced stop,
    network error, or crash), tool parts that were created with
    state.status='running' never get updated to 'completed' or 'error'.
    This leaves the frontend stuck in a perpetual "thinking" state because
    ActivitySummary sees hasRunningTools=true and isCompleted=false.

    Heuristic:
    - If the message has a step-finish → the step is done; any 'running'
      tools are orphans → mark them 'error'.
    - If the message has NO step-finish → the step was interrupted; any
      'running' tools are orphans → mark them 'error'.

    Returns a list of (part_orm, fixed_data) tuples.  fixed_data is the
    original p.data for unchanged parts (no copy), or a shallow copy with
    the corrected state for orphan-running parts.
    """
    has_step_finish = any(
        (p.data or {}).get("type") == "step-finish" for p in parts
    )
    # Early exit: no step-finish and no running tools → nothing to fix
    if not has_step_finish:
        has_running = any(
            (p.data or {}).get("type") == "tool"
            and (p.data or {}).get("state", {}).get("status") == "running"
            for p in parts
        )
        if not has_running:
            return [(p, p.data or {}) for p in parts]

    result = []
    for p in parts:
        d = p.data or {}
        if d.get("type") == "tool" and d.get("state", {}).get("status") == "running":
            # Shallow-copy data so we don't mutate the ORM object
            fixed = {**d, "state": {**d["state"], "status": "error"}}
            if not fixed["state"].get("output"):
                fixed["state"]["output"] = "Tool execution interrupted"
            result.append((p, fixed))
        else:
            result.append((p, d))
    return result


def _msg_to_response(msg: Message) -> MessageResponse:
    parts = _sanitize_orphan_running_parts(msg.parts)
    return MessageResponse(
        id=msg.id,
        session_id=msg.session_id,
        time_created=msg.time_created,
        data=msg.data or {},
        parts=[
            PartResponse(
                id=p.id,
                message_id=p.message_id,
                session_id=p.session_id,
                time_created=p.time_created,
                data=fixed_data,
            )
            for p, fixed_data in parts
        ],
    )


@router.get("/messages/{session_id}", response_model=PaginatedMessages)
async def list_messages(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=-1),
) -> PaginatedMessages:
    """Get messages for a session with pagination.

    offset=-1 (default) returns the latest page.

    Uses a standalone read-only session instead of the transactional get_db
    dependency to avoid "A transaction is already begun" errors when the
    same session is reused for count + select queries within one request.
    """
    sf = get_session_factory()
    async with sf() as db:
        total = await count_messages(db, session_id)
        actual_offset = max(0, total - limit) if offset < 0 else offset
        messages = await get_messages(db, session_id, limit=limit, offset=actual_offset)
        return PaginatedMessages(
            total=total,
            offset=actual_offset,
            messages=[_msg_to_response(msg) for msg in messages],
        )


@router.get("/messages/{session_id}/{message_id}", response_model=MessageResponse)
async def get_message(
    session_id: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Get a single message with its parts."""
    stmt = (
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.parts))
    )
    msg = (await db.execute(stmt)).scalar_one_or_none()
    if msg is None or msg.session_id != session_id:
        raise HTTPException(status_code=404, detail="Message not found")

    return _msg_to_response(msg)

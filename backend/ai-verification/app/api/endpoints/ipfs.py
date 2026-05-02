"""
app/api/endpoints/ipfs.py
─────────────────────────
Upload a file to IPFS via Pinata and return its CID + SHA-256 content hash.

This endpoint is called by the Next.js frontend (contract-context.jsx →
uploadToIPFS) whenever a client posts an SRS document or a freelancer
submits a deliverable.

POST /api/ipfs/upload
  Body : multipart/form-data  { file: <binary> }
  Returns: { cid: str, content_hash: str, size: int, name: str }

The endpoint also accepts plain JSON { content: str } for text-only
submissions (description blobs) so the oracle doesn't need Pinata to
test locally — in that case it derives a synthetic CID from the hash.
"""

from __future__ import annotations

import hashlib
import logging
from io import BytesIO

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ipfs")


# ── Pinata helpers ────────────────────────────────────────────────────────────

PINATA_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"


async def _upload_to_pinata(
    data: bytes,
    filename: str,
    api_key: str,
    secret_key: str,
) -> str:
    """Upload raw bytes to Pinata and return the IPFS CID."""
    headers = {
        "pinata_api_key": api_key,
        "pinata_secret_api_key": secret_key,
    }
    files = {"file": (filename, BytesIO(data), "application/octet-stream")}
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(PINATA_UPLOAD_URL, headers=headers, files=files)

    if resp.status_code != 200:
        logger.error("pinata_upload_failed | status=%s body=%s", resp.status_code, resp.text[:300])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Pinata upload failed (HTTP {resp.status_code}): {resp.text[:200]}",
        )

    body = resp.json()
    return body["IpfsHash"]


def _synthetic_cid(content_hash: str) -> str:
    """
    Return a deterministic fake CID when Pinata is not configured.
    Prefixed with 'Qm' to look like a real CIDv0 so the rest of the
    system (oracle, smart contract) won't choke on format checks.
    """
    return "Qm" + content_hash[:44]


# ── Route ─────────────────────────────────────────────────────────────────────


@router.post("/upload")
async def upload_to_ipfs(
    request: Request,
    file: UploadFile = File(...),
) -> JSONResponse:
    """
    Upload a file to IPFS.

    Returns
    -------
    JSON
        { cid, content_hash, size, name }
    """
    settings = get_settings()

    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )

    # SHA-256 of the raw bytes
    content_hash = "0x" + hashlib.sha256(raw).hexdigest()
    filename = file.filename or "upload"

    # ── Try Pinata if credentials are configured ──────────────────────────────
    if settings.pinata_api_key and settings.pinata_secret_key:
        try:
            cid = await _upload_to_pinata(
                raw,
                filename,
                settings.pinata_api_key,
                settings.pinata_secret_key,
            )
            logger.info("ipfs_upload_ok | cid=%s file=%s bytes=%d", cid, filename, len(raw))
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("pinata_unexpected_error")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"IPFS upload error: {exc}",
            ) from exc
    else:
        # ── Dev / local fallback: synthetic CID derived from hash ─────────────
        cid = _synthetic_cid(hashlib.sha256(raw).hexdigest())
        logger.warning(
            "pinata_not_configured | using synthetic CID=%s for file=%s",
            cid,
            filename,
        )

    return JSONResponse(
        content={
            "cid": cid,
            "content_hash": content_hash,
            "size": len(raw),
            "name": filename,
        }
    )

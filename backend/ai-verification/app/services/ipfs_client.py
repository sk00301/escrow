"""
app/services/ipfs_client.py
────────────────────────────
Download a submission archive from IPFS via the Pinata gateway.

The downloaded archive is written to a local temp file, then the caller
(the background verification task) extracts it and passes the path to
CodeVerifier.verify().
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def download_from_ipfs(cid: str) -> Path:
    """
    Download the content at `cid` from the Pinata gateway and return the
    path to a local temporary file.

    The caller is responsible for deleting the file when finished.

    Parameters
    ----------
    cid : str
        IPFS CID, with or without the "ipfs://" prefix.

    Returns
    -------
    Path
        Path to the downloaded file (a .zip archive is expected).

    Raises
    ------
    httpx.HTTPStatusError
        If the gateway returns a non-2xx response.
    httpx.TimeoutException
        If the download takes longer than 60 seconds.
    """
    settings = get_settings()

    # Strip protocol prefix if present
    clean_cid = cid.removeprefix("ipfs://").strip()
    url = f"{settings.pinata_gateway}/ipfs/{clean_cid}"

    logger.info("ipfs_download_start", extra={"cid": clean_cid, "url": url})

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()

    # Write to a named temp file; suffix helps the extractor pick the right handler
    suffix = ".zip"
    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, prefix="ipfs_download_"
    )
    tmp.write(response.content)
    tmp.close()

    logger.info(
        "ipfs_download_complete",
        extra={
            "cid": clean_cid,
            "bytes": len(response.content),
            "path": tmp.name,
        },
    )
    return Path(tmp.name)

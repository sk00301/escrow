"""
app/services/llm/ollama_provider.py

LLM provider for Ollama — supports text and vision (multimodal) models.
qwen3.5 and similar vision-capable models accept base64-encoded images
alongside text in the messages array.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5-coder:latest",
        timeout: float = 120.0,
        temperature: float = 0.1,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout
        self._temperature = temperature

    @property
    def name(self) -> str:
        return f"ollama/{self._model}"

    # ------------------------------------------------------------------
    # Text completion
    # ------------------------------------------------------------------

    async def complete(self, prompt: str, system: str = "") -> str:
        prompt = self.truncate_prompt(prompt, self._context_max_chars())
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await self._chat(messages)

    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,
    ) -> dict:
        json_hint = (
            "You must respond with valid JSON only. "
            "Do NOT wrap the JSON in markdown code fences (``` or ```json). "
            "Output the raw JSON object directly."
        )
        return await self._complete_json_with_retry(
            prompt=prompt,
            system=system,
            schema=schema,
            extra_hint=json_hint,
        )

    # ------------------------------------------------------------------
    # Vision / multimodal completion
    # ------------------------------------------------------------------

    async def complete_with_images(
        self,
        prompt: str,
        images: list[str | Path],
        system: str = "",
    ) -> str:
        """
        Send a text prompt alongside images to a vision-capable model.

        Args:
            prompt:  Text prompt describing what to do with the images.
            images:  List of file paths or already-base64-encoded strings.
                     Supported: PNG, JPG, JPEG, GIF, WEBP, BMP.
            system:  Optional system prompt.

        Returns:
            Model's text response.
        """
        encoded: list[str] = []
        for img in images:
            p = Path(img) if not isinstance(img, Path) else img
            if p.exists():
                encoded.append(_b64_image(p))
            elif isinstance(img, str) and len(img) > 200:
                encoded.append(img)  # already base64
            else:
                raise LLMProviderError(f"Image not found: {img}")

        prompt = self.truncate_prompt(prompt, self._context_max_chars())

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})

        user_msg: dict = {"role": "user", "content": prompt}
        if encoded:
            user_msg["images"] = encoded
        messages.append(user_msg)

        return await self._chat(messages)

    async def complete_json_with_images(
        self,
        prompt: str,
        images: list[str | Path],
        system: str = "",
    ) -> dict:
        """
        Send a prompt with images and return parsed JSON.
        Used when an SRS document contains diagrams or screenshots.
        """
        json_hint = (
            "You must respond with valid JSON only. "
            "Do NOT use markdown code fences. "
            "Output the raw JSON object directly."
        )
        aug_system = f"{system}\n{json_hint}".strip() if system else json_hint
        max_retries = self._max_retries()
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                raw = await self.complete_with_images(prompt, images, system=aug_system)
                return json.loads(self.strip_markdown_fences(raw))
            except (json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "[OllamaProvider] json+images attempt %d/%d: %s",
                    attempt, max_retries, exc,
                )

        raise LLMProviderError(
            f"[{self.name}] JSON+images failed after {max_retries} attempts: {last_error}"
        )

    # ------------------------------------------------------------------
    # Internal HTTP
    # ------------------------------------------------------------------

    async def _chat(self, messages: list[dict]) -> str:
        payload = {
            "model": self._model,
            "stream": False,
            "messages": messages,
            "options": {"temperature": self._temperature},
            # Disable chain-of-thought thinking for qwen3/qwen3.5.
            # Without this these models think for 2-5 minutes before responding,
            # causing frontend polling timeouts. Other models safely ignore this key.
            "think": False,
        }
        url = f"{self._base_url}/api/chat"
        logger.debug("[OllamaProvider] POST %s model=%s", url, self._model)

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
        except httpx.ConnectError as exc:
            raise LLMProviderError(
                f"Ollama is not running or not reachable at '{self._base_url}'. "
                "Start with: ollama serve"
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError(
                f"Ollama timed out after {self._timeout}s."
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise LLMProviderError(
                f"Ollama HTTP {exc.response.status_code}: {exc.response.text}"
            ) from exc

        try:
            return response.json()["message"]["content"]
        except (KeyError, ValueError) as exc:
            raise LLMProviderError(
                f"Unexpected Ollama response: {response.text[:500]}"
            ) from exc

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_settings(cls, settings: Any = None) -> "OllamaProvider":
        def _get(attr, env, default):
            if settings is not None and hasattr(settings, attr):
                return str(getattr(settings, attr))
            return os.environ.get(env, default)

        return cls(
            base_url=_get("ollama_base_url", "OLLAMA_BASE_URL", "http://localhost:11434"),
            model=_get("ollama_model", "OLLAMA_MODEL", "qwen2.5-coder:latest"),
            timeout=float(_get("ollama_timeout", "OLLAMA_TIMEOUT", "120")),
            temperature=float(_get("llm_temperature", "LLM_TEMPERATURE", "0.1")),
        )

    @classmethod
    def from_config(cls, settings: Any = None) -> "OllamaProvider":
        return cls.from_settings(settings)


def _b64_image(path: Path) -> str:
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        raise LLMProviderError(f"Unsupported image format: {path.suffix}")
    return base64.b64encode(path.read_bytes()).decode("utf-8")

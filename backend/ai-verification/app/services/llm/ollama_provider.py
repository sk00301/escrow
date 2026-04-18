"""
app/services/llm/ollama_provider.py

LLM provider implementation for Ollama (local, free, private inference).

Calls: POST http://<OLLAMA_BASE_URL>/api/chat
Uses the chat endpoint so system and user roles are handled natively.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    """
    LLM provider that calls a locally running Ollama instance.

    Environment variables consumed:
        OLLAMA_BASE_URL   Base URL of the Ollama server   (default: http://localhost:11434)
        OLLAMA_MODEL      Model tag to use                (default: qwen2.5-coder:latest)
        OLLAMA_TIMEOUT    HTTP timeout in seconds         (default: 120)
        LLM_TEMPERATURE   Sampling temperature            (default: 0.1)
        LLM_MAX_RETRIES   JSON parse retries              (default: 3)
        LLM_CONTEXT_MAX_CHARS  Prompt char limit          (default: 8000)
    """

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

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return f"ollama/{self._model}"

    async def complete(self, prompt: str, system: str = "") -> str:
        """
        Call the Ollama /api/chat endpoint and return the assistant reply.

        The prompt is truncated to LLM_CONTEXT_MAX_CHARS before sending.

        Raises:
            LLMProviderError: If Ollama is not running or returns an error.
        """
        prompt = self.truncate_prompt(prompt, self._context_max_chars())

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload: dict = {
            "model": self._model,
            "stream": False,
            "messages": messages,
            "options": {"temperature": self._temperature},
        }

        url = f"{self._base_url}/api/chat"
        logger.debug("[OllamaProvider] POST %s  model=%s", url, self._model)

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
        except httpx.ConnectError as exc:
            raise LLMProviderError(
                f"Ollama is not running or not reachable at '{self._base_url}'. "
                "Start Ollama with: ollama serve"
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMProviderError(
                f"Ollama request timed out after {self._timeout}s. "
                "Consider increasing OLLAMA_TIMEOUT or using a smaller model."
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise LLMProviderError(
                f"Ollama returned HTTP {exc.response.status_code}: {exc.response.text}"
            ) from exc

        try:
            data: dict = response.json()
            content: str = data["message"]["content"]
        except (KeyError, ValueError) as exc:
            raise LLMProviderError(
                f"Unexpected response shape from Ollama: {response.text[:500]}"
            ) from exc

        logger.debug("[OllamaProvider] received %d chars", len(content))
        return content

    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,
    ) -> dict:
        """
        Return a parsed JSON dict from the Ollama model.

        Strips markdown code fences (```json … ```) that Ollama frequently
        wraps its JSON responses in, then retries up to LLM_MAX_RETRIES
        times on parse failure.

        Args:
            prompt: User-turn content.
            system: System instruction.
            schema: Unused by Ollama; accepted for interface compatibility.

        Returns:
            Parsed dict.

        Raises:
            LLMProviderError: After all retries are exhausted.
        """
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
    # Factory helpers
    # ------------------------------------------------------------------

    @classmethod
    def from_settings(cls, settings: Any = None) -> "OllamaProvider":
        """Build an OllamaProvider from a settings object or env vars."""

        def _get(attr: str, env_key: str, default: str) -> str:
            if settings is not None and hasattr(settings, attr):
                return str(getattr(settings, attr))
            return os.environ.get(env_key, default)

        base_url = _get("ollama_base_url", "OLLAMA_BASE_URL", "http://localhost:11434")
        model = _get("ollama_model", "OLLAMA_MODEL", "qwen2.5-coder:latest")
        timeout = float(_get("ollama_timeout", "OLLAMA_TIMEOUT", "120"))
        temperature = float(_get("llm_temperature", "LLM_TEMPERATURE", "0.1"))

        return cls(
            base_url=base_url,
            model=model,
            timeout=timeout,
            temperature=temperature,
        )

    # Alias so both from_config (base class) and from_settings work
    @classmethod
    def from_config(cls, settings: Any = None) -> "OllamaProvider":
        return cls.from_settings(settings)

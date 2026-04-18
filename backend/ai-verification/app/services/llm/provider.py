"""
app/services/llm/provider.py

Abstract base class for the LLM provider abstraction layer.
All concrete providers (Ollama, OpenAI, Anthropic) inherit from this.
"""

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class LLMProviderError(Exception):
    """Raised when an LLM provider is misconfigured or unavailable."""


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """
    Unified interface for LLM backends.

    Concrete implementations must provide:
      - complete()       → plain-text response
      - complete_json()  → parsed dict (with automatic retry + fence stripping)
      - name property    → identifier string used in logs / config
    """

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable / config identifier for this provider."""

    @abstractmethod
    async def complete(self, prompt: str, system: str = "") -> str:
        """
        Send a prompt and return the model's text response.

        Args:
            prompt: The user-turn content.
            system: Optional system prompt / instruction preamble.

        Returns:
            The raw text reply from the model.

        Raises:
            LLMProviderError: If the provider is unavailable or the call fails.
        """

    @abstractmethod
    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,
    ) -> dict:
        """
        Send a prompt and return the model's response parsed as a dict.

        Implementations MUST:
          1. Strip markdown code fences (```json … ```) before parsing.
          2. Retry up to LLM_MAX_RETRIES times on JSON parse failure.
          3. Raise LLMProviderError after all retries are exhausted.

        Args:
            prompt:  The user-turn content.
            system:  Optional system prompt.
            schema:  Optional JSON-schema dict for providers that support
                     structured/constrained output (e.g. OpenAI json_object).
                     Implementations that ignore it must still work correctly.

        Returns:
            Parsed dict from the model's response.

        Raises:
            LLMProviderError: If valid JSON cannot be obtained after retries.
        """

    # ------------------------------------------------------------------
    # Shared helpers (available to all subclasses)
    # ------------------------------------------------------------------

    @staticmethod
    def strip_markdown_fences(text: str) -> str:
        """
        Remove ```json … ``` or ``` … ``` wrappers that LLMs often add.

        Handles:
          - ```json\\n{...}\\n```
          - ```\\n{...}\\n```
          - Leading/trailing whitespace
        """
        text = text.strip()
        # Remove opening fence (with optional language tag)
        if text.startswith("```"):
            first_newline = text.find("\n")
            if first_newline != -1:
                text = text[first_newline + 1:]
        # Remove closing fence
        if text.endswith("```"):
            text = text[: text.rfind("```")]
        return text.strip()

    @staticmethod
    def truncate_prompt(prompt: str, max_chars: int) -> str:
        """
        Truncate *prompt* to *max_chars* characters to avoid context overflow.

        A warning is logged when truncation occurs so the caller is aware.
        """
        if len(prompt) <= max_chars:
            return prompt
        logger.warning(
            "Prompt truncated from %d to %d characters (LLM_CONTEXT_MAX_CHARS=%d)",
            len(prompt),
            max_chars,
            max_chars,
        )
        return prompt[:max_chars]

    @staticmethod
    def _max_retries() -> int:
        """Read LLM_MAX_RETRIES from env, default 3."""
        try:
            return int(os.environ.get("LLM_MAX_RETRIES", "3"))
        except ValueError:
            return 3

    @staticmethod
    def _context_max_chars() -> int:
        """Read LLM_CONTEXT_MAX_CHARS from env, default 8000."""
        try:
            return int(os.environ.get("LLM_CONTEXT_MAX_CHARS", "8000"))
        except ValueError:
            return 8000

    # ------------------------------------------------------------------
    # Default complete_json implementation (subclasses may override)
    # ------------------------------------------------------------------

    async def _complete_json_with_retry(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,  # noqa: ARG002  (unused in default impl)
        extra_hint: str = "Respond with valid JSON only, no markdown fences.",
    ) -> dict:
        """
        Default retry loop used by providers that don't have native JSON mode.

        Calls self.complete() up to LLM_MAX_RETRIES times, strips fences,
        and attempts JSON parsing after each attempt.
        """
        max_retries: int = self._max_retries()
        augmented_system = f"{system}\n{extra_hint}".strip() if system else extra_hint

        last_error: Exception | None = None
        for attempt in range(1, max_retries + 1):
            try:
                raw = await self.complete(prompt, system=augmented_system)
                cleaned = self.strip_markdown_fences(raw)
                return json.loads(cleaned)
            except (json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "[%s] complete_json attempt %d/%d failed: %s",
                    self.name,
                    attempt,
                    max_retries,
                    exc,
                )

        raise LLMProviderError(
            f"[{self.name}] Failed to obtain valid JSON after "
            f"{max_retries} attempts. Last error: {last_error}"
        )

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, settings: Any = None) -> "LLMProvider":
        """
        Factory method: reads LLM_PROVIDER (and related env vars / settings)
        and returns the appropriate concrete LLMProvider implementation.

        Priority:
          1. settings.llm_provider  (Pydantic Settings object, if provided)
          2. LLM_PROVIDER env var
          3. Default: "ollama"

        Supported values: "ollama", "openai", "anthropic"

        Args:
            settings: Optional Pydantic Settings / config object.  If None
                      the factory falls back to environment variables directly.

        Returns:
            A configured LLMProvider instance ready for use.

        Raises:
            LLMProviderError: If the provider name is unknown.
        """
        # Resolve provider name
        if settings is not None and hasattr(settings, "llm_provider"):
            provider_name: str = str(settings.llm_provider).lower()
        else:
            provider_name = os.environ.get("LLM_PROVIDER", "ollama").lower()

        logger.info("LLMProvider.from_config: initialising provider='%s'", provider_name)

        # Import here to avoid circular imports at module level
        if provider_name == "ollama":
            from app.services.llm.ollama_provider import OllamaProvider  # noqa: PLC0415
            return OllamaProvider.from_settings(settings)

        if provider_name == "openai":
            from app.services.llm.openai_provider import OpenAIProvider  # noqa: PLC0415
            return OpenAIProvider.from_settings(settings)

        if provider_name == "anthropic":
            from app.services.llm.anthropic_provider import AnthropicProvider  # noqa: PLC0415
            return AnthropicProvider.from_settings(settings)

        raise LLMProviderError(
            f"Unknown LLM provider '{provider_name}'. "
            "Valid options: 'ollama', 'openai', 'anthropic'."
        )

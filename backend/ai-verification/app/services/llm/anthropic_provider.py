"""
app/services/llm/anthropic_provider.py

LLM provider implementation for the Anthropic API (optional, paid).

Uses the official `anthropic` Python library with AsyncAnthropic client.
complete_json() applies the base-class retry loop with fence stripping
since Anthropic's API does not have a native json_object mode.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)

# Anthropic API requires a max_tokens value
_DEFAULT_MAX_TOKENS = 4096


class AnthropicProvider(LLMProvider):
    """
    LLM provider that calls the Anthropic Messages API.

    Environment variables consumed:
        ANTHROPIC_API_KEY  API key (required)
        ANTHROPIC_MODEL    Model name           (default: claude-3-haiku-20240307)
        LLM_TEMPERATURE    Sampling temperature (default: 0.1)
        LLM_MAX_RETRIES    JSON parse retries   (default: 3)
        LLM_CONTEXT_MAX_CHARS  Prompt char limit (default: 8000)
    """

    def __init__(
        self,
        api_key: str,
        model: str = "claude-3-haiku-20240307",
        temperature: float = 0.1,
        max_tokens: int = _DEFAULT_MAX_TOKENS,
    ) -> None:
        if not api_key:
            raise LLMProviderError(
                "ANTHROPIC_API_KEY is not set. "
                "Export it in your environment or .env file before using the Anthropic provider."
            )
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens

        try:
            import anthropic  # noqa: PLC0415
            self._client = anthropic.AsyncAnthropic(api_key=api_key)
        except ImportError as exc:
            raise LLMProviderError(
                "The 'anthropic' package is not installed. "
                "Run: pip install anthropic"
            ) from exc

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return f"anthropic/{self._model}"

    async def complete(self, prompt: str, system: str = "") -> str:
        """
        Call the Anthropic Messages endpoint and return the reply text.

        Raises:
            LLMProviderError: On API errors or missing credentials.
        """
        import anthropic  # noqa: PLC0415

        prompt = self.truncate_prompt(prompt, self._context_max_chars())

        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self._temperature,
        }
        if system:
            kwargs["system"] = system

        logger.debug("[AnthropicProvider] messages model=%s", self._model)

        try:
            response = await self._client.messages.create(**kwargs)
        except anthropic.AuthenticationError as exc:
            raise LLMProviderError(
                "Anthropic authentication failed. Check your ANTHROPIC_API_KEY."
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise LLMProviderError(
                "Could not connect to the Anthropic API. Check your network."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise LLMProviderError(
                "Anthropic rate limit exceeded. Wait a moment and retry."
            ) from exc
        except anthropic.AnthropicError as exc:
            raise LLMProviderError(f"Anthropic API error: {exc}") from exc

        # Extract text from the first content block
        content_blocks = response.content
        if not content_blocks:
            raise LLMProviderError("Anthropic returned an empty response.")

        text_parts = [
            block.text for block in content_blocks
            if hasattr(block, "text")
        ]
        content = "".join(text_parts)
        logger.debug("[AnthropicProvider] received %d chars", len(content))
        return content

    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,
    ) -> dict:
        """
        Return a parsed JSON dict from the Anthropic model.

        Uses the base-class retry loop with fence stripping and a JSON hint
        injected into the system prompt.

        Args:
            prompt:  User-turn content.
            system:  System instruction.
            schema:  Accepted for interface compatibility; not forwarded.

        Returns:
            Parsed dict.

        Raises:
            LLMProviderError: After all retries are exhausted.
        """
        json_hint = (
            "You must respond with valid JSON only. "
            "Do NOT include any explanatory text, prose, or markdown code fences. "
            "Output the raw JSON object directly, starting with { and ending with }."
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
    def from_settings(cls, settings: Any = None) -> "AnthropicProvider":
        """Build an AnthropicProvider from a settings object or env vars."""

        def _get(attr: str, env_key: str, default: str) -> str:
            if settings is not None and hasattr(settings, attr):
                return str(getattr(settings, attr))
            return os.environ.get(env_key, default)

        api_key = _get("anthropic_api_key", "ANTHROPIC_API_KEY", "")
        model = _get("anthropic_model", "ANTHROPIC_MODEL", "claude-3-haiku-20240307")
        temperature = float(_get("llm_temperature", "LLM_TEMPERATURE", "0.1"))

        return cls(api_key=api_key, model=model, temperature=temperature)

    @classmethod
    def from_config(cls, settings: Any = None) -> "AnthropicProvider":
        return cls.from_settings(settings)

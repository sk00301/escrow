"""
app/services/llm/openai_provider.py

LLM provider implementation for the OpenAI API (optional, paid).

Uses the official `openai` Python library with AsyncOpenAI client.
complete_json() leverages response_format={"type": "json_object"} for
reliable structured output — no fence-stripping or manual retries needed
for the primary path, but the base-class retry loop is still invoked as
a safety net in case the model returns an unexpected shape.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    """
    LLM provider that calls the OpenAI Chat Completions API.

    Environment variables consumed:
        OPENAI_API_KEY    API key (required)
        OPENAI_MODEL      Model name           (default: gpt-4o-mini)
        LLM_TEMPERATURE   Sampling temperature (default: 0.1)
        LLM_MAX_RETRIES   JSON parse retries   (default: 3)
        LLM_CONTEXT_MAX_CHARS  Prompt char limit (default: 8000)
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        temperature: float = 0.1,
    ) -> None:
        if not api_key:
            raise LLMProviderError(
                "OPENAI_API_KEY is not set. "
                "Export it in your environment or .env file before using the OpenAI provider."
            )
        self._api_key = api_key
        self._model = model
        self._temperature = temperature

        # Lazy import so projects that don't use OpenAI don't need the package
        try:
            import openai  # noqa: PLC0415
            self._client = openai.AsyncOpenAI(api_key=api_key)
        except ImportError as exc:
            raise LLMProviderError(
                "The 'openai' package is not installed. "
                "Run: pip install openai"
            ) from exc

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return f"openai/{self._model}"

    async def complete(self, prompt: str, system: str = "") -> str:
        """
        Call the OpenAI Chat Completions endpoint and return the reply text.

        Raises:
            LLMProviderError: On API errors or missing credentials.
        """
        import openai  # noqa: PLC0415

        prompt = self.truncate_prompt(prompt, self._context_max_chars())

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        logger.debug("[OpenAIProvider] chat model=%s", self._model)

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                temperature=self._temperature,
            )
        except openai.AuthenticationError as exc:
            raise LLMProviderError(
                "OpenAI authentication failed. Check your OPENAI_API_KEY."
            ) from exc
        except openai.APIConnectionError as exc:
            raise LLMProviderError(
                "Could not connect to the OpenAI API. Check your network."
            ) from exc
        except openai.RateLimitError as exc:
            raise LLMProviderError(
                "OpenAI rate limit exceeded. Wait a moment and retry."
            ) from exc
        except openai.OpenAIError as exc:
            raise LLMProviderError(f"OpenAI API error: {exc}") from exc

        content: str = response.choices[0].message.content or ""
        logger.debug("[OpenAIProvider] received %d chars", len(content))
        return content

    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        schema: dict | None = None,  # noqa: ARG002
    ) -> dict:
        """
        Return a parsed JSON dict using OpenAI's json_object response format.

        The json_object mode guarantees the model output is valid JSON, so
        no fence-stripping is needed.  The base-class retry loop is still
        called as a defensive layer.

        Args:
            prompt:  User-turn content.
            system:  System instruction.
            schema:  Accepted but not forwarded (json_object mode is sufficient).

        Returns:
            Parsed dict.

        Raises:
            LLMProviderError: On API errors or if parsing fails.
        """
        import openai  # noqa: PLC0415

        prompt = self.truncate_prompt(prompt, self._context_max_chars())

        # OpenAI requires "json" somewhere in the messages when using json_object
        json_hint = "Respond with a valid JSON object."
        augmented_system = f"{system}\n{json_hint}".strip() if system else json_hint

        messages: list[dict] = [
            {"role": "system", "content": augmented_system},
            {"role": "user", "content": prompt},
        ]

        logger.debug("[OpenAIProvider] complete_json model=%s", self._model)

        max_retries = self._max_retries()
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    temperature=self._temperature,
                    response_format={"type": "json_object"},
                )
            except openai.AuthenticationError as exc:
                raise LLMProviderError(
                    "OpenAI authentication failed. Check your OPENAI_API_KEY."
                ) from exc
            except openai.OpenAIError as exc:
                raise LLMProviderError(f"OpenAI API error: {exc}") from exc

            raw: str = response.choices[0].message.content or ""
            cleaned = self.strip_markdown_fences(raw)

            try:
                import json  # noqa: PLC0415
                return json.loads(cleaned)
            except (json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "[OpenAIProvider] complete_json attempt %d/%d parse failed: %s",
                    attempt,
                    max_retries,
                    exc,
                )

        raise LLMProviderError(
            f"[{self.name}] Failed to parse JSON after {max_retries} attempts. "
            f"Last error: {last_error}"
        )

    # ------------------------------------------------------------------
    # Factory helpers
    # ------------------------------------------------------------------

    @classmethod
    def from_settings(cls, settings: Any = None) -> "OpenAIProvider":
        """Build an OpenAIProvider from a settings object or env vars."""

        def _get(attr: str, env_key: str, default: str) -> str:
            if settings is not None and hasattr(settings, attr):
                return str(getattr(settings, attr))
            return os.environ.get(env_key, default)

        api_key = _get("openai_api_key", "OPENAI_API_KEY", "")
        model = _get("openai_model", "OPENAI_MODEL", "gpt-4o-mini")
        temperature = float(_get("llm_temperature", "LLM_TEMPERATURE", "0.1"))

        return cls(api_key=api_key, model=model, temperature=temperature)

    @classmethod
    def from_config(cls, settings: Any = None) -> "OpenAIProvider":
        return cls.from_settings(settings)

"""
tests/unit/test_llm_provider.py

Unit tests for the LLM provider abstraction layer.

Test strategy
─────────────
Most tests use mocking/patching so the suite runs without a live Ollama
process.  Tests that touch real Ollama inference are marked with
@pytest.mark.ollama and skipped when the OLLAMA_LIVE_TESTS env var is not
set.  This lets CI run quickly while allowing thorough local validation.

Run all tests (mocked):
    pytest tests/unit/test_llm_provider.py -v

Run with live Ollama (requires `ollama serve` + a pulled model):
    OLLAMA_LIVE_TESTS=1 pytest tests/unit/test_llm_provider.py -v -m ollama
"""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio  # noqa: F401  (needed for async fixtures in older pytest)

# ---------------------------------------------------------------------------
# Helpers / constants
# ---------------------------------------------------------------------------

LIVE_OLLAMA = os.environ.get("OLLAMA_LIVE_TESTS", "").strip() in ("1", "true", "yes")
ollama_skip = pytest.mark.skipif(
    not LIVE_OLLAMA,
    reason="Skipping live Ollama test — set OLLAMA_LIVE_TESTS=1 to enable",
)

SAMPLE_JSON_RESPONSE = '{"score": 0.85, "verdict": "APPROVED"}'
FENCED_JSON_RESPONSE = f"```json\n{SAMPLE_JSON_RESPONSE}\n```"
FENCED_NO_LANG_RESPONSE = f"```\n{SAMPLE_JSON_RESPONSE}\n```"
INVALID_JSON_RESPONSE = "Sorry, I cannot answer that."


# ===========================================================================
# 1. LLMProvider base-class helpers
# ===========================================================================

class TestStripMarkdownFences:
    """strip_markdown_fences() must handle all common fence variants."""

    def _strip(self, text: str) -> str:
        from app.services.llm.provider import LLMProvider
        return LLMProvider.strip_markdown_fences(text)

    def test_strips_json_fence(self):
        result = self._strip(FENCED_JSON_RESPONSE)
        assert result == SAMPLE_JSON_RESPONSE

    def test_strips_plain_fence(self):
        result = self._strip(FENCED_NO_LANG_RESPONSE)
        assert result == SAMPLE_JSON_RESPONSE

    def test_no_fence_unchanged(self):
        result = self._strip(SAMPLE_JSON_RESPONSE)
        assert result == SAMPLE_JSON_RESPONSE

    def test_strips_whitespace(self):
        result = self._strip(f"  \n{SAMPLE_JSON_RESPONSE}\n  ")
        assert result == SAMPLE_JSON_RESPONSE

    def test_result_is_valid_json(self):
        result = self._strip(FENCED_JSON_RESPONSE)
        parsed = json.loads(result)
        assert parsed["verdict"] == "APPROVED"


class TestTruncatePrompt:
    """truncate_prompt() must truncate at exactly max_chars."""

    def _truncate(self, text: str, max_chars: int) -> str:
        from app.services.llm.provider import LLMProvider
        return LLMProvider.truncate_prompt(text, max_chars)

    def test_no_truncation_when_short(self):
        text = "hello"
        assert self._truncate(text, 100) == text

    def test_truncates_at_max_chars(self):
        text = "a" * 200
        result = self._truncate(text, 100)
        assert len(result) == 100

    def test_exact_length_not_truncated(self):
        text = "x" * 50
        assert self._truncate(text, 50) == text

    def test_long_prompt_truncated_to_llm_context_max_chars(self):
        """Integration check: prompts longer than LLM_CONTEXT_MAX_CHARS are trimmed."""
        from app.services.llm.provider import LLMProvider
        max_chars = LLMProvider._context_max_chars()
        long_prompt = "z" * (max_chars + 500)
        result = LLMProvider.truncate_prompt(long_prompt, max_chars)
        assert len(result) == max_chars


# ===========================================================================
# 2. OllamaProvider — mocked
# ===========================================================================

class TestOllamaProviderMocked:
    """Tests for OllamaProvider using mocked httpx responses."""

    def _make_provider(self, **kwargs):
        from app.services.llm.ollama_provider import OllamaProvider
        return OllamaProvider(
            base_url="http://localhost:11434",
            model="qwen2.5-coder:latest",
            timeout=30,
            temperature=0.1,
            **kwargs,
        )

    def _mock_chat_response(self, content: str) -> MagicMock:
        """Build a mock httpx.Response that returns a valid Ollama chat payload."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "message": {"role": "assistant", "content": content}
        }
        mock_resp.raise_for_status = MagicMock()
        return mock_resp

    @pytest.mark.asyncio
    async def test_complete_returns_text(self):
        provider = self._make_provider()
        mock_resp = self._mock_chat_response("Hello from Ollama!")

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.complete("Say hello")
            assert result == "Hello from Ollama!"

    @pytest.mark.asyncio
    async def test_complete_json_parses_plain_json(self):
        provider = self._make_provider()
        mock_resp = self._mock_chat_response(SAMPLE_JSON_RESPONSE)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.complete_json("Return JSON")
            assert result == {"score": 0.85, "verdict": "APPROVED"}

    @pytest.mark.asyncio
    async def test_complete_json_strips_fences(self):
        """complete_json must successfully parse JSON wrapped in ```json fences."""
        provider = self._make_provider()
        mock_resp = self._mock_chat_response(FENCED_JSON_RESPONSE)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.complete_json("Return JSON")
            assert result["verdict"] == "APPROVED"

    @pytest.mark.asyncio
    async def test_complete_json_retries_on_invalid_json(self):
        """
        If the first N-1 responses are invalid JSON the provider should retry
        and eventually succeed on the last attempt.
        """
        from app.services.llm.ollama_provider import OllamaProvider
        provider = self._make_provider()

        call_count = 0

        async def fake_complete(prompt, system=""):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                return INVALID_JSON_RESPONSE  # will fail JSON parse
            return SAMPLE_JSON_RESPONSE  # succeeds on 3rd attempt

        provider.complete = fake_complete  # type: ignore[assignment]

        with patch.dict(os.environ, {"LLM_MAX_RETRIES": "3"}):
            result = await provider.complete_json("Return JSON")

        assert result == {"score": 0.85, "verdict": "APPROVED"}
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_complete_json_raises_after_all_retries(self):
        """
        After LLM_MAX_RETRIES failed attempts, LLMProviderError must be raised.
        """
        from app.services.llm.provider import LLMProviderError
        provider = self._make_provider()

        async def always_invalid(prompt, system=""):
            return INVALID_JSON_RESPONSE

        provider.complete = always_invalid  # type: ignore[assignment]

        with patch.dict(os.environ, {"LLM_MAX_RETRIES": "3"}):
            with pytest.raises(LLMProviderError, match="Failed to obtain valid JSON"):
                await provider.complete_json("Return JSON")

    @pytest.mark.asyncio
    async def test_raises_when_ollama_not_running(self):
        """LLMProviderError must be raised with a helpful message if Ollama is down."""
        import httpx
        from app.services.llm.provider import LLMProviderError
        provider = self._make_provider()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            with pytest.raises(LLMProviderError, match="not running"):
                await provider.complete("Hello")

    @pytest.mark.asyncio
    async def test_prompt_truncated_before_send(self):
        """Prompts exceeding LLM_CONTEXT_MAX_CHARS must be truncated."""
        provider = self._make_provider()
        mock_resp = self._mock_chat_response("ok")

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            long_prompt = "x" * 20_000
            with patch.dict(os.environ, {"LLM_CONTEXT_MAX_CHARS": "100"}):
                await provider.complete(long_prompt)

            # Check that the prompt sent was capped at 100 chars
            call_kwargs = mock_client.post.call_args
            sent_payload = call_kwargs.kwargs.get("json") or call_kwargs.args[1]
            user_message = next(
                m for m in sent_payload["messages"] if m["role"] == "user"
            )
            assert len(user_message["content"]) == 100

    def test_name_property(self):
        provider = self._make_provider()
        assert provider.name == "ollama/qwen2.5-coder:latest"


# ===========================================================================
# 3. OpenAIProvider — mocked
# ===========================================================================

class TestOpenAIProviderMocked:
    """Tests for OpenAIProvider using mocked openai client."""

    def _make_provider(self):
        with patch("openai.AsyncOpenAI"):
            from app.services.llm.openai_provider import OpenAIProvider
            return OpenAIProvider(api_key="sk-test-fake", model="gpt-4o-mini")

    def test_raises_without_api_key(self):
        from app.services.llm.provider import LLMProviderError
        with patch("openai.AsyncOpenAI"):
            from app.services.llm.openai_provider import OpenAIProvider
            with pytest.raises(LLMProviderError, match="OPENAI_API_KEY"):
                OpenAIProvider(api_key="")

    def test_name_property(self):
        provider = self._make_provider()
        assert provider.name == "openai/gpt-4o-mini"

    @pytest.mark.asyncio
    async def test_complete_json_strips_fences(self):
        """Even with json_object mode, fences should be stripped defensively."""
        provider = self._make_provider()

        mock_choice = MagicMock()
        mock_choice.message.content = FENCED_JSON_RESPONSE
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        provider._client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await provider.complete_json("Return JSON")
        assert result["verdict"] == "APPROVED"


# ===========================================================================
# 4. AnthropicProvider — mocked
# ===========================================================================

class TestAnthropicProviderMocked:
    """Tests for AnthropicProvider using mocked anthropic client."""

    def _make_provider(self):
        with patch("anthropic.AsyncAnthropic"):
            from app.services.llm.anthropic_provider import AnthropicProvider
            return AnthropicProvider(api_key="sk-ant-fake", model="claude-3-haiku-20240307")

    def test_raises_without_api_key(self):
        from app.services.llm.provider import LLMProviderError
        with patch("anthropic.AsyncAnthropic"):
            from app.services.llm.anthropic_provider import AnthropicProvider
            with pytest.raises(LLMProviderError, match="ANTHROPIC_API_KEY"):
                AnthropicProvider(api_key="")

    def test_name_property(self):
        provider = self._make_provider()
        assert provider.name == "anthropic/claude-3-haiku-20240307"

    @pytest.mark.asyncio
    async def test_complete_json_retries_on_invalid_json(self):
        """AnthropicProvider retry loop must work identically to Ollama."""
        provider = self._make_provider()
        call_count = 0

        async def fake_complete(prompt, system=""):
            nonlocal call_count
            call_count += 1
            return SAMPLE_JSON_RESPONSE if call_count >= 2 else INVALID_JSON_RESPONSE

        provider.complete = fake_complete  # type: ignore[assignment]

        with patch.dict(os.environ, {"LLM_MAX_RETRIES": "3"}):
            result = await provider.complete_json("JSON please")
        assert result["score"] == 0.85
        assert call_count == 2


# ===========================================================================
# 5. Factory method — from_config / get_provider_from_config
# ===========================================================================

class TestProviderFactory:
    """LLMProvider.from_config() must return the correct concrete class."""

    def _factory(self, provider_name: str, extra_env: dict | None = None):
        env = {"LLM_PROVIDER": provider_name}
        if extra_env:
            env.update(extra_env)
        with (
            patch.dict(os.environ, env),
            patch("openai.AsyncOpenAI"),
            patch("anthropic.AsyncAnthropic"),
        ):
            from app.services.llm.provider import LLMProvider
            return LLMProvider.from_config()

    def test_factory_returns_ollama(self):
        from app.services.llm.ollama_provider import OllamaProvider
        provider = self._factory("ollama")
        assert isinstance(provider, OllamaProvider)

    def test_factory_returns_openai(self):
        from app.services.llm.openai_provider import OpenAIProvider
        provider = self._factory("openai", {"OPENAI_API_KEY": "sk-fake"})
        assert isinstance(provider, OpenAIProvider)

    def test_factory_returns_anthropic(self):
        from app.services.llm.anthropic_provider import AnthropicProvider
        provider = self._factory("anthropic", {"ANTHROPIC_API_KEY": "sk-ant-fake"})
        assert isinstance(provider, AnthropicProvider)

    def test_factory_unknown_provider_raises(self):
        from app.services.llm.provider import LLMProviderError
        with patch.dict(os.environ, {"LLM_PROVIDER": "unknown_llm"}):
            from app.services.llm.provider import LLMProvider
            with pytest.raises(LLMProviderError, match="Unknown LLM provider"):
                LLMProvider.from_config()

    def test_get_provider_from_config_convenience(self):
        """Module-level get_provider_from_config() should work identically."""
        with (
            patch.dict(os.environ, {"LLM_PROVIDER": "ollama"}),
        ):
            from app.services.llm import get_provider_from_config, OllamaProvider
            provider = get_provider_from_config()
            assert isinstance(provider, OllamaProvider)


# ===========================================================================
# 6. Live Ollama tests (skipped unless OLLAMA_LIVE_TESTS=1)
# ===========================================================================

@pytest.mark.ollama
class TestOllamaLive:
    """
    Integration tests that call a real running Ollama instance.

    These are skipped by default.  To run them:
      1. Start Ollama:  ollama serve
      2. Pull a model:  ollama pull qwen2.5-coder:latest
      3. Set env var:   export OLLAMA_LIVE_TESTS=1
      4. Run:           pytest tests/unit/test_llm_provider.py -m ollama -v
    """

    def _provider(self):
        from app.services.llm.ollama_provider import OllamaProvider
        return OllamaProvider(
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            model=os.environ.get("OLLAMA_MODEL", "llama3.2:3b"),
            timeout=float(os.environ.get("OLLAMA_TIMEOUT", "300")),
        )

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_complete_returns_string(self):
        provider = self._provider()
        result = await provider.complete("Reply with exactly the word: PONG")
        assert isinstance(result, str)
        assert len(result) > 0

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_complete_json_returns_dict(self):
        provider = self._provider()
        result = await provider.complete_json(
            'Return a JSON object with a single key "status" set to "ok".'
        )
        assert isinstance(result, dict)
        assert "status" in result

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_complete_json_from_fenced_response(self):
        """
        Instruct the model to deliberately use fences, then verify we strip them.
        """
        provider = self._provider()
        prompt = (
            "Return the following JSON wrapped in ```json fences:\n"
            '{"test": true, "wrapped": true}'
        )
        result = await provider.complete_json(prompt)
        assert isinstance(result, dict)

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_retry_logic(self):
        """
        Monkey-patch complete() to fail twice then succeed, and verify
        complete_json() retries correctly against a live model response shape.
        """
        provider = self._provider()
        original_complete = provider.complete
        call_count = 0

        async def patched_complete(prompt, system=""):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                return "not valid json at all !!!"
            return await original_complete(
                'Return only: {"retried": true}', system=system
            )

        provider.complete = patched_complete  # type: ignore[assignment]

        with patch.dict(os.environ, {"LLM_MAX_RETRIES": "3"}):
            result = await provider.complete_json("ignored — patched")
        assert isinstance(result, dict)
        assert call_count == 3

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_prompt_truncation(self):
        """A prompt much longer than LLM_CONTEXT_MAX_CHARS should still succeed."""
        provider = self._provider()
        long_prompt = (
            "Ignore the following noise and reply with JSON {\"ok\": true}.\n"
            + ("NOISE " * 2000)
        )
        with patch.dict(os.environ, {"LLM_CONTEXT_MAX_CHARS": "500"}):
            result = await provider.complete_json(long_prompt)
        assert isinstance(result, dict)

    @ollama_skip
    @pytest.mark.asyncio
    async def test_live_service_unavailable_raises(self):
        """
        Pointing to a non-existent server must raise LLMProviderError,
        not a raw httpx exception.
        """
        from app.services.llm.ollama_provider import OllamaProvider
        from app.services.llm.provider import LLMProviderError

        bad_provider = OllamaProvider(
            base_url="http://localhost:19999",  # nothing runs here
            model="qwen2.5-coder:latest",
            timeout=5,
        )
        with pytest.raises(LLMProviderError, match="not running"):
            await bad_provider.complete("Hello")

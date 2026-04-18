"""
app/services/llm/__init__.py

Public API for the LLM provider abstraction layer.

Usage
-----
    from app.services.llm import get_provider_from_config, LLMProviderError

    provider = get_provider_from_config()          # reads LLM_PROVIDER env var
    text     = await provider.complete("Hello!")
    data     = await provider.complete_json("Return a JSON object with key 'ok'.")

Or with a Pydantic settings object:

    from app.core.config import get_settings
    from app.services.llm import get_provider_from_config

    provider = get_provider_from_config(get_settings())
"""

from app.services.llm.provider import LLMProvider, LLMProviderError
from app.services.llm.ollama_provider import OllamaProvider
from app.services.llm.openai_provider import OpenAIProvider
from app.services.llm.anthropic_provider import AnthropicProvider


def get_provider_from_config(settings=None) -> LLMProvider:
    """
    Convenience module-level factory.

    Delegates to LLMProvider.from_config() so callers can import from
    a single location without needing to know which class to instantiate.

    Args:
        settings: Optional Pydantic Settings object.  If None, the factory
                  falls back to LLM_PROVIDER / other environment variables.

    Returns:
        A configured, ready-to-use LLMProvider instance.

    Raises:
        LLMProviderError: If the provider name is unknown or required
                          credentials are missing.
    """
    return LLMProvider.from_config(settings)


__all__ = [
    "LLMProvider",
    "LLMProviderError",
    "OllamaProvider",
    "OpenAIProvider",
    "AnthropicProvider",
    "get_provider_from_config",
]

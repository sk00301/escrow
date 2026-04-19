"""
app/core/config.py
Centralised settings object. Every other module imports from here.
"""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_version: str = "1.0.0"
    log_level: str = "DEBUG"

    # CORS
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    # Rate limiting
    rate_limit_max_per_minute: int = 10

    # Blockchain / Oracle
    oracle_private_key: str = ""
    escrow_contract_address: str = ""
    evidence_registry_address: str = ""
    dispute_contract_address: str = ""
    alchemy_rpc_url: str = ""
    chain_id: int = 11155111

    # IPFS / Pinata
    pinata_api_key: str = ""
    pinata_secret_key: str = ""
    pinata_gateway: str = "https://gateway.pinata.cloud"

    # AI Scoring Thresholds (legacy /verify endpoint)
    ambiguity_band_low: float = 0.45
    ambiguity_band_high: float = 0.75
    approval_threshold: float = 0.75
    weight_test_pass: float = 0.50
    weight_static_analysis: float = 0.25
    weight_complexity: float = 0.15
    weight_semantic: float = 0.10

    # Task Queue
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Database
    database_url: str = "sqlite+aiosqlite:///./verification_jobs.db"

    # Docker Sandbox
    docker_sandbox_image: str = "python:3.11-slim"
    docker_timeout_seconds: int = 30
    docker_memory_limit: str = "256m"
    docker_cpu_period: int = 100000
    docker_cpu_quota: int = 50000

    # Security
    secret_key: str = "CHANGE_ME_IN_PRODUCTION"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # LLM Provider Selection
    llm_provider: str = "ollama"
    llm_model: str = "qwen2.5-coder:latest"

    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5-coder:latest"
    ollama_timeout: float = 300.0

    # OpenAI
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"

    # Anthropic
    anthropic_api_key: Optional[str] = None
    anthropic_model: str = "claude-3-haiku-20240307"

    # LLM Scoring Weights
    llm_weight_requirements: float = 0.40
    llm_weight_test_execution: float = 0.30
    llm_weight_code_quality: float = 0.20
    llm_weight_static_analysis: float = 0.10

    # Agent Behaviour
    llm_max_retries: int = 3
    llm_temperature: float = 0.1
    llm_context_max_chars: int = 8000

    # LLM Decision Gate
    verdict_approved_threshold: float = 0.75
    verdict_rejected_threshold: float = 0.45


@lru_cache
def get_settings() -> Settings:
    """
    Return a cached Settings singleton.
    Use as a FastAPI dependency:  settings: Settings = Depends(get_settings)
    Or import directly:           from app.core.config import get_settings
    """
    return Settings()

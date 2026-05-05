from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    port: int = 8001

    # Database
    database_url: str

    # Blockchain
    alchemy_rpc_url: str
    escrow_contract_address: str

    # Governance rules (no defaults → must come from env)
    voting_days: int
    quorum: int
    max_active_proposals: int


@lru_cache
def get_settings() -> Settings:
    return Settings()
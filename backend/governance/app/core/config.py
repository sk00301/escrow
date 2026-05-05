from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    port:    int = 8001

    # Database
    database_url: str = "sqlite+aiosqlite:///./governance.db"

    # Blockchain
    alchemy_rpc_url:         str = ""
    escrow_contract_address: str = ""

    # Governance rules
    voting_days:             int = 7
    quorum:                  int = 10
    max_active_proposals:    int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()

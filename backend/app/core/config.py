import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_files() -> list[str]:
    files = [".env"]
    override = os.environ.get("OCTAVIA_ENV_FILE", "").strip()
    if override:
        files.insert(0, override)
    return files


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=tuple(_env_files()),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Octavia Production"
    api_prefix: str = "/api"
    secret_key: str = "octavia-dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 12
    algorithm: str = "HS256"
    database_url: str = "mysql+pymysql://root:@127.0.0.1:3306/octavia_production"
    demo_mode: bool = True
    factory_timezone: str = "Europe/Budapest"
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost,http://127.0.0.1,"
        "http://127.0.0.1:17800,http://localhost:17800"
    )
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"


@lru_cache
def get_settings() -> Settings:
    return Settings()

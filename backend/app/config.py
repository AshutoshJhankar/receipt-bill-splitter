"""Runtime settings from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # Any OpenAI-compatible chat-completions API with a vision model
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout_s: float = 60.0

    # Supabase (PostgREST). Without these, bills are kept in memory (local dev).
    supabase_url: str = ""
    supabase_service_key: str = ""
    retention_days: int = 90

    max_image_mb: float = 6.0
    allowed_origins: str = "*"
    rate_limit_per_10min: int = 15

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.getenv
        return cls(
            llm_api_key=e("LLM_API_KEY", ""),
            llm_base_url=e("LLM_BASE_URL", cls.llm_base_url),
            llm_model=e("LLM_MODEL", cls.llm_model),
            llm_timeout_s=float(e("LLM_TIMEOUT_S", cls.llm_timeout_s)),
            supabase_url=e("SUPABASE_URL", "").rstrip("/"),
            supabase_service_key=e("SUPABASE_SERVICE_KEY", ""),
            retention_days=int(e("RETENTION_DAYS", cls.retention_days)),
            max_image_mb=float(e("MAX_IMAGE_MB", cls.max_image_mb)),
            allowed_origins=e("ALLOWED_ORIGINS", cls.allowed_origins),
            rate_limit_per_10min=int(e("RATE_LIMIT_PER_10MIN", cls.rate_limit_per_10min)),
        )

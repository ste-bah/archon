"""Sample Python file for parser testing."""

import os
import sys
from pathlib import Path
from typing import Optional, List
from collections.abc import Callable

from . import utils
from .models import User, Role
from ..shared import config

try:
    import ujson as json
except ImportError:
    import json


TIMEOUT = 30
MAX_RETRIES = 3


class BaseService:
    """Base service class."""

    def __init__(self, name: str) -> None:
        self.name = name

    def start(self) -> None:
        pass


class AuthService(BaseService):
    """Authentication service."""

    def __init__(self, secret: str, timeout: int = TIMEOUT) -> None:
        super().__init__("auth")
        self.secret = secret
        self.timeout = timeout

    def authenticate(self, token: str) -> Optional[User]:
        pass

    def _validate_token(self, token: str) -> bool:
        pass


def create_app(config_path: Path) -> "App":
    """Factory function."""
    pass


async def fetch_data(url: str, retries: int = MAX_RETRIES) -> List[dict]:
    """Async data fetcher."""
    pass


__all__ = ["AuthService", "create_app", "fetch_data"]

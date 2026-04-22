import pytest


# Говорим pytest-asyncio что все async тесты запускаются в одном event loop
# без этого каждый тест создаёт свой loop → конфликты с httpx
def pytest_configure(config):
    config.addinivalue_line("markers", "asyncio: mark test as async")

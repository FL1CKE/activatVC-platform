"""
Абстракция над LLM провайдерами.

Почему не использовать LangChain? Слишком тяжёлая зависимость для нашей задачи.
Нам нужно только одно: отправить messages → получить text. Делаем сами — 100 строк,
полный контроль, никакой магии.

Паттерн: Strategy — каждый провайдер реализует один интерфейс LLMProvider.
Добавить новый провайдер = написать один класс из 20 строк.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import logging
import os

logger = logging.getLogger(__name__)


@dataclass
class LLMMessage:
    role: str   # "system" | "user" | "assistant"
    content: str


@dataclass
class LLMResponse:
    content: str
    model: str
    tokens_used: int
    provider: str


class LLMProvider(ABC):
    """Базовый интерфейс — все провайдеры реализуют только этот метод."""

    @abstractmethod
    async def complete(
        self,
        messages: list[LLMMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        pass


# ─── OpenAI ────────────────────────────────────────────────────────────────────

class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str):
        # Импорт внутри класса — не падаем если библиотека не установлена
        # для других провайдеров
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key)

    async def complete(
        self,
        messages: list[LLMMessage],
        model: str = "gpt-4o",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        response = await self.client.chat.completions.create(
            model=model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return LLMResponse(
            content=response.choices[0].message.content or "",
            model=response.model,
            tokens_used=response.usage.total_tokens if response.usage else 0,
            provider="openai",
        )


# ─── Anthropic (Claude) ────────────────────────────────────────────────────────

class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str):
        from anthropic import AsyncAnthropic
        import httpx
        self.client = AsyncAnthropic(
            api_key=api_key,
            timeout=httpx.Timeout(1200.0, connect=30.0),  # 20 min read, 30s connect
        )

    async def complete(
        self,
        messages: list[LLMMessage],
        model: str = "claude-sonnet-4-6",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        # Anthropic отделяет system prompt от messages
        system_content = ""
        chat_messages = []

        for m in messages:
            if m.role == "system":
                system_content = m.content
            else:
                chat_messages.append({"role": m.role, "content": m.content})

        kwargs = dict(
            model=model,
            max_tokens=max_tokens,
            messages=chat_messages,
        )
        if system_content:
            kwargs["system"] = system_content

        # Используем streaming для длинных ответов — предотвращает разрыв TCP соединения
        # при генерации больших ответов (особенно CMO+CCO с ~59KB промптом)
        text_chunks = []
        input_tokens = 0
        output_tokens = 0
        response_model = model

        async with self.client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                text_chunks.append(text)
            final = await stream.get_final_message()
            input_tokens = final.usage.input_tokens
            output_tokens = final.usage.output_tokens
            response_model = final.model

        return LLMResponse(
            content="".join(text_chunks),
            model=response_model,
            tokens_used=input_tokens + output_tokens,
            provider="anthropic",
        )


# ─── Google Gemini ─────────────────────────────────────────────────────────────

class GoogleProvider(LLMProvider):
    """Google Gemini via AI Studio (google.generativeai). Vertex AI removed — system is 100% Anthropic."""

    def __init__(self, api_key: str):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._genai = genai

    async def complete(
        self,
        messages: list[LLMMessage],
        model: str = "gemini-2.5-flash",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        import asyncio

        gemini_model = self._genai.GenerativeModel(
            model_name=model,
            generation_config=self._genai.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            ),
        )

        prompt_parts = []
        for m in messages:
            if m.role == "system":
                prompt_parts.append(f"[System Instructions]\n{m.content}\n\n")
            elif m.role == "user":
                prompt_parts.append(m.content)

        full_prompt = "\n".join(prompt_parts)

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: gemini_model.generate_content(full_prompt),
        )

        return LLMResponse(
            content=response.text,
            model=model,
            tokens_used=0,
            provider="google",
        )


# ─── Factory ───────────────────────────────────────────────────────────────────

def create_llm_provider(provider: str, api_key: str) -> LLMProvider:
    """
    Фабрика провайдеров.
    provider — строка из БД ("openai" | "anthropic" | "google")
    """
    providers = {
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider,
        "google": GoogleProvider,
    }
    cls = providers.get(provider.lower())
    if not cls:
        raise ValueError(
            f"Unknown LLM provider: '{provider}'. Available: {list(providers.keys())}"
        )
    return cls(api_key=api_key)

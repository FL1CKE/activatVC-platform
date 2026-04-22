"""
Мок-данные для трёх тестовых стартапов.
Формат полностью соответствует ответу GET /api/webhooks/startups/{id}/data

Используется в:
- тестах (pytest)
- ручном запуске через UI без реального Master Agent
- разработке новых агентов

ВАЖНО: application_id — реальные UUID формата Master Agent
"""

MOCK_STARTUPS: dict[str, dict] = {

    # ─── Стартап 1: SaaS B2B, хорошо описан ───────────────────────────────────
    "mock-saas-001": {
        "application": {
            "id": "mock-saas-001",
            "startupName": "DataPilot",
            "startupStage": "Series A",
            "activityType": "SaaS",
            "description": (
                "DataPilot — платформа для автоматизации аналитики данных для e-commerce компаний. "
                "Мы заменяем команду аналитиков ИИ-агентами, которые строят дашборды, "
                "выявляют аномалии и прогнозируют выручку в реальном времени."
            ),
            "businessModel": (
                "SaaS подписка. Тарифы: Starter $299/мес (до 1М событий), "
                "Growth $999/мес (до 10М событий), Enterprise от $3000/мес. "
                "Средний чек $720/мес. NRR 118%."
            ),
            "financialSummary": (
                "ARR $1.8M. MoM growth 12%. Burn rate $180K/мес. "
                "Runway 14 месяцев. CAC $2,400. LTV $12,600. LTV/CAC = 5.25. "
                "Gross margin 74%."
            ),
            "websiteUrl": "https://datapilot.io",
            "driveLink": "https://drive.google.com/drive/folders/mock-saas-001",
            "investmentAmount": 2500000,
            "currency": "USD",
            "founders": [
                {
                    "name": "Алексей Морозов",
                    "role": "CEO",
                    "linkedin": "https://linkedin.com/in/mock-morozov",
                    "background": "Ex-Yandex Data, 8 лет в продуктовой аналитике",
                },
                {
                    "name": "Sarah Chen",
                    "role": "CTO",
                    "linkedin": "https://linkedin.com/in/mock-chen",
                    "background": "PhD Stanford ML, ex-Databricks senior engineer",
                },
            ],
        },
        "documents": [
            {
                "id": "doc-001-1",
                "originalName": "DataPilot_Pitch_Deck.pdf",
                "mimeType": "application/pdf",
                "category": "pitch",
                "classifiedAs": "PitchDeck",
                "fileUrl": "http://127.0.0.1:9100/mock/datapilot-pitch.pdf",
            },
            {
                "id": "doc-001-2",
                "originalName": "Financial_Model_Q3_2024.xlsx",
                "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "category": "finance",
                "classifiedAs": "FinancialModel",
                "fileUrl": "http://127.0.0.1:9100/mock/datapilot-financials.xlsx",
            },
            {
                "id": "doc-001-3",
                "originalName": "Team_Overview.docx",
                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "category": "team",
                "classifiedAs": "TeamDocument",
                "fileUrl": "http://127.0.0.1:9100/mock/datapilot-team.docx",
            },
        ],
    },

    # ─── Стартап 2: Marketplace, неполные данные (тест needs_info) ────────────
    "mock-marketplace-002": {
        "application": {
            "id": "mock-marketplace-002",
            "startupName": "CraftHub",
            "startupStage": "Seed",
            "activityType": "Marketplace",
            "description": (
                "CraftHub — маркетплейс для покупки и продажи handmade товаров в СНГ. "
                "Конкурируем с Etsy, но фокусируемся на локальных мастерах и быстрой доставке (2-3 дня)."
            ),
            "businessModel": (
                "Комиссия 12% с каждой транзакции + опциональная подписка для продавцов $19/мес "
                "с расширенными инструментами продвижения."
            ),
            "financialSummary": (
                "GMV $320K за последние 12 месяцев. "
                "Take rate 11.5%. Revenue $36.8K. Команда 8 человек."
                # Намеренно не указаны: burn rate, runway, unit economics
            ),
            "websiteUrl": "https://crafthub.ru",
            "driveLink": None,   # нет Drive папки — тест на отсутствие документов
            "investmentAmount": 500000,
            "currency": "USD",
            "founders": [
                {
                    "name": "Мария Петрова",
                    "role": "CEO & Co-founder",
                    "linkedin": None,
                    "background": "7 лет в e-commerce, ex-Wildberries category manager",
                },
            ],
        },
        "documents": [
            {
                "id": "doc-002-1",
                "originalName": "CraftHub_Overview.pdf",
                "mimeType": "application/pdf",
                "category": "pitch",
                "classifiedAs": "PitchDeck",
                "fileUrl": "http://127.0.0.1:9100/mock/crafthub-overview.pdf",
            },
            # Намеренно нет финансовой модели и данных о команде → CFO и CHRO запросят needs_info
        ],
    },

    # ─── Стартап 3: DeepTech / Hardware, сложный кейс ─────────────────────────
    "mock-deeptech-003": {
        "application": {
            "id": "mock-deeptech-003",
            "startupName": "NeuralSense",
            "startupStage": "Pre-Seed",
            "activityType": "DeepTech / Hardware",
            "description": (
                "NeuralSense разрабатывает носимые нейроинтерфейсы для мониторинга когнитивной нагрузки "
                "у операторов критической инфраструктуры (пилоты, диспетчеры АЭС). "
                "Наш сенсор считывает ЭЭГ без геля через обычную кепку, точность 94% vs 91% у медицинских аналогов."
            ),
            "businessModel": (
                "B2G + B2B. Пилоты с авиакомпаниями $50K-200K контракты. "
                "В перспективе SaaS-платформа для мониторинга $500/устройство/мес."
            ),
            "financialSummary": (
                "Pre-revenue. Грант Сколково 15M руб получен. "
                "2 LOI от авиакомпаний на пилоты. "
                "Seeking $1.5M для производства первой партии 500 устройств и клинических испытаний."
            ),
            "websiteUrl": "https://neuralsense.tech",
            "driveLink": "https://drive.google.com/drive/folders/mock-deeptech-003",
            "investmentAmount": 1500000,
            "currency": "USD",
            "founders": [
                {
                    "name": "Dr. Дмитрий Волков",
                    "role": "CEO & Chief Scientist",
                    "linkedin": "https://linkedin.com/in/mock-volkov",
                    "background": "PhD нейробиология МГУ, 12 публикаций в Nature/IEEE, ex-Samsung Research",
                },
                {
                    "name": "Иван Соколов",
                    "role": "CTO & Hardware Lead",
                    "linkedin": "https://linkedin.com/in/mock-sokolov",
                    "background": "Ex-Skoltech, специализация embedded systems и медицинские устройства",
                },
                {
                    "name": "Анна Лебедева",
                    "role": "COO",
                    "linkedin": "https://linkedin.com/in/mock-lebedeva",
                    "background": "Ex-McKinsey, 5 лет в healthtech стратегии",
                },
            ],
        },
        "documents": [
            {
                "id": "doc-003-1",
                "originalName": "NeuralSense_TechSpec_v2.pdf",
                "mimeType": "application/pdf",
                "category": "technical",
                "classifiedAs": "TechnicalDocument",
                "fileUrl": "http://127.0.0.1:9100/mock/neuralsense-techspec.pdf",
            },
            {
                "id": "doc-003-2",
                "originalName": "Clinical_Trial_Protocol.pdf",
                "mimeType": "application/pdf",
                "category": "regulatory",
                "classifiedAs": "RegulatoryDocument",
                "fileUrl": "http://127.0.0.1:9100/mock/neuralsense-clinical.pdf",
            },
            {
                "id": "doc-003-3",
                "originalName": "NeuralSense_Pitch_2024.pdf",
                "mimeType": "application/pdf",
                "category": "pitch",
                "classifiedAs": "PitchDeck",
                "fileUrl": "http://127.0.0.1:9100/mock/neuralsense-pitch.pdf",
            },
        ],
    },
}


def get_mock_startup(application_id: str) -> dict | None:
    return MOCK_STARTUPS.get(application_id)


def list_mock_ids() -> list[str]:
    return list(MOCK_STARTUPS.keys())

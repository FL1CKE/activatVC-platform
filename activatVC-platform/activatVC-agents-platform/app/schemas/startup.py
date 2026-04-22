from pydantic import BaseModel, HttpUrl, field_validator
from typing import Any


class FounderSchema(BaseModel):
    name: str
    role: str
    linkedin: str | None = None
    background: str | None = None


class StartupApplicationSchema(BaseModel):
    id: str
    startupName: str
    startupStage: str | None = None
    activityType: str | None = None
    description: str | None = None
    businessModel: str | None = None
    financialSummary: str | None = None
    websiteUrl: str | None = None
    driveLink: str | None = None
    investmentAmount: float | None = None
    currency: str | None = None
    founders: list[FounderSchema] = []


class StartupDocumentSchema(BaseModel):
    id: str
    originalName: str
    mimeType: str
    category: str | None = None
    classifiedAs: str | None = None
    fileUrl: str


class StartupDataSchema(BaseModel):
    """Полный ответ GET /data"""
    application: StartupApplicationSchema
    documents: list[StartupDocumentSchema] = []

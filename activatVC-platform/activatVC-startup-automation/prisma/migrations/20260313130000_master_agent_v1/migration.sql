DROP TABLE IF EXISTS "ApplicationEvent" CASCADE;
DROP TABLE IF EXISTS "AgentRun" CASCADE;
DROP TABLE IF EXISTS "MagicLinkSession" CASCADE;
DROP TABLE IF EXISTS "GapItem" CASCADE;
DROP TABLE IF EXISTS "ApplicationDocument" CASCADE;
DROP TABLE IF EXISTS "Application" CASCADE;

CREATE TABLE "Application" (
  "id" TEXT NOT NULL,
  "startupName" TEXT NOT NULL,
  "founderEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "startupType" TEXT,
  "startupStage" TEXT,
  "activityType" TEXT,
  "description" TEXT,
  "businessModel" TEXT,
  "financialSummary" TEXT,
  "websiteUrl" TEXT,
  "driveLink" TEXT,
  "investmentAmount" DOUBLE PRECISION,
  "currency" TEXT DEFAULT 'USD',
  "founders" JSONB,
  "founderProfiles" JSONB,
  "latestDocumentIndex" JSONB,
  "currentRound" INTEGER NOT NULL DEFAULT 0,
  "investmentScore" DOUBLE PRECISION,
  "verdict" TEXT,
  "heroPhrase" TEXT,
  "executiveSummary" TEXT,
  "interviewQuestions" JSONB,
  "aggregateReport" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationDocument" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "classifiedAs" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "readable" BOOLEAN NOT NULL DEFAULT true,
  "summary" TEXT,
  "source" TEXT NOT NULL DEFAULT 'founder_upload',
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GapItem" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "gapType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "inputType" TEXT NOT NULL,
  "requestedByAgent" TEXT,
  "affectsAgents" JSONB,
  "responseText" TEXT,
  "responseDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "GapItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MagicLinkSession" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastAccessedAt" TIMESTAMP(3),
  CONSTRAINT "MagicLinkSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "requestPayload" JSONB NOT NULL,
  "responsePayload" JSONB,
  "score" DOUBLE PRECISION,
  "requestedDocuments" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationEvent" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MagicLinkSession_token_key" ON "MagicLinkSession"("token");

ALTER TABLE "ApplicationDocument"
ADD CONSTRAINT "ApplicationDocument_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapItem"
ADD CONSTRAINT "GapItem_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapItem"
ADD CONSTRAINT "GapItem_responseDocumentId_fkey"
FOREIGN KEY ("responseDocumentId") REFERENCES "ApplicationDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MagicLinkSession"
ADD CONSTRAINT "MagicLinkSession_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationEvent"
ADD CONSTRAINT "ApplicationEvent_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

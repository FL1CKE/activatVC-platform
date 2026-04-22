-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "startupName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "preliminaryScore" DOUBLE PRECISION,
    "ideaClarityScore" DOUBLE PRECISION,
    "problemExistenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerValue" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

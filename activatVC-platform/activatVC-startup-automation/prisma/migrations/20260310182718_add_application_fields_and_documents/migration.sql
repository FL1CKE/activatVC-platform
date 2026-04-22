/*
  Warnings:

  - You are about to drop the column `ideaClarityScore` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `preliminaryScore` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `problemExistenceScore` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the `ApplicationAnswer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ApplicationAnswer" DROP CONSTRAINT "ApplicationAnswer_applicationId_fkey";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "ideaClarityScore",
DROP COLUMN "preliminaryScore",
DROP COLUMN "problemExistenceScore",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "executiveSummary" TEXT,
ADD COLUMN     "founderNames" TEXT,
ADD COLUMN     "interviewQuestions" JSONB,
ADD COLUMN     "investmentScore" DOUBLE PRECISION,
ADD COLUMN     "startupStage" TEXT,
ADD COLUMN     "startupType" TEXT,
ADD COLUMN     "verdict" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- DropTable
DROP TABLE "ApplicationAnswer";

-- CreateTable
CREATE TABLE "ApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

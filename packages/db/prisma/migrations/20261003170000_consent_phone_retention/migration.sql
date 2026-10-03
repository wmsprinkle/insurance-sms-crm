-- AlterTable
ALTER TABLE "consentRecord" ADD COLUMN "e164" TEXT,
ADD COLUMN "contactSnapshot" JSONB,
ADD COLUMN "detachedAt" TIMESTAMP(3);

-- Backfill
UPDATE "consentRecord" AS c
SET "e164" = ct."phone"
FROM "contact" AS ct
WHERE ct."id" = c."contactId" AND c."e164" IS NULL;

-- AlterTable
ALTER TABLE "consentRecord" ALTER COLUMN "contactId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "consentRecord" DROP CONSTRAINT "consentRecord_contactId_fkey";

-- AddForeignKey
ALTER TABLE "consentRecord" ADD CONSTRAINT "consentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "consentRecord_e164_revokedAt_idx" ON "consentRecord"("e164", "revokedAt");

-- AlterTable
ALTER TABLE "smsDraft" ADD COLUMN "idempotencyKey" TEXT;

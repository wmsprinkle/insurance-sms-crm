-- CreateEnum
CREATE TYPE "SmsDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELIVERY_FAILED', 'SENDING_FAILED', 'DELIVERY_UNCONFIRMED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('WEB_FORM', 'LEAD_IMPORT', 'API', 'SMS_KEYWORD', 'MANUAL');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('STOP_KEYWORD', 'OPT_OUT_REQUEST', 'WRONG_NUMBER', 'CARRIER_BLOCK', 'MANUAL');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'SMS';

-- AlterEnum
ALTER TYPE "RecordSource" ADD VALUE 'LEAD_IMPORT';

-- CreateTable
CREATE TABLE "smsMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" "SmsDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "telnyxId" TEXT,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentRecord" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "optInText" TEXT,
    "optInUrl" TEXT,
    "ip" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phoneSuppression" (
    "e164" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phoneSuppression_pkey" PRIMARY KEY ("e164")
);

-- CreateIndex
CREATE UNIQUE INDEX "smsMessage_telnyxId_key" ON "smsMessage"("telnyxId");

-- CreateIndex
CREATE INDEX "smsMessage_contactId_createdAt_idx" ON "smsMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "consentRecord_contactId_revokedAt_idx" ON "consentRecord"("contactId", "revokedAt");

-- Normalise existing phones to E.164 before they become unique. Mirrors
-- toE164() in @crm/validation/phone: bare 10-digit and 1+10-digit numbers are
-- read as North American. Anything else is left as it was (see the CHECK below).
UPDATE "contact" SET "phone" = NULLIF(btrim("phone"), '') WHERE "phone" IS NOT NULL;

UPDATE "contact"
SET "phone" = CASE
    WHEN "phone" LIKE '+%' THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN "phone" LIKE '00%' THEN '+' || substr(regexp_replace("phone", '\D', '', 'g'), 3)
    WHEN length(regexp_replace("phone", '\D', '', 'g')) = 10
        THEN '+1' || regexp_replace("phone", '\D', '', 'g')
    WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11
        AND regexp_replace("phone", '\D', '', 'g') LIKE '1%'
        THEN '+' || regexp_replace("phone", '\D', '', 'g')
    ELSE "phone"
END
WHERE "phone" IS NOT NULL;

-- New and updated rows must be E.164. NOT VALID: rows that could not be
-- normalised above are kept rather than dropped, but cannot be saved again
-- until fixed. If two active contacts share a number the unique index below
-- fails and names it; merge or archive one and re-run.
ALTER TABLE "contact" ADD CONSTRAINT "contact_phone_e164_check"
    CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

-- CreateIndex
CREATE UNIQUE INDEX "contact_phone_active_key" ON "contact"("phone") WHERE ("archivedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "smsMessage" ADD CONSTRAINT "smsMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentRecord" ADD CONSTRAINT "consentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


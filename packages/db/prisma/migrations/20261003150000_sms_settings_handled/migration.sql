-- AlterTable
ALTER TABLE "appSetting" ADD COLUMN "sms" JSONB;

-- AlterTable
ALTER TABLE "smsMessage" ADD COLUMN "handledAt" TIMESTAMP(3);

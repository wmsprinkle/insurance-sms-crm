-- CreateEnum
CREATE TYPE "SmsDraftStatus" AS ENUM ('PENDING', 'APPROVED', 'DISCARDED');

-- CreateTable
CREATE TABLE "smsDraft" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "retryAt" TIMESTAMP(3),
    "taskId" TEXT,
    "status" "SmsDraftStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smsHandoff" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "smsHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "smsDraft_status_createdAt_idx" ON "smsDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "smsDraft_contactId_createdAt_idx" ON "smsDraft"("contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "smsHandoff_contactId_key" ON "smsHandoff"("contactId");

-- AddForeignKey
ALTER TABLE "smsDraft" ADD CONSTRAINT "smsDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smsHandoff" ADD CONSTRAINT "smsHandoff_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


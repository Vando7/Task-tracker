-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommentReaction" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("commentId", "userId", "emoji"),
    CONSTRAINT "CommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotifyPreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "onAssigned" BOOLEAN NOT NULL DEFAULT true,
    "onDueSoon" BOOLEAN NOT NULL DEFAULT true,
    "onOverdue" BOOLEAN NOT NULL DEFAULT true,
    "onCompletedByOther" BOOLEAN NOT NULL DEFAULT true,
    "onCommented" BOOLEAN NOT NULL DEFAULT true,
    "dueSoonLeadHours" INTEGER NOT NULL DEFAULT 24,
    "quietFrom" TEXT,
    "quietTo" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifyPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotifyPreference" ("dueSoonLeadHours", "enabled", "onAssigned", "onCompletedByOther", "onDueSoon", "onOverdue", "quietFrom", "quietTo", "updatedAt", "userId") SELECT "dueSoonLeadHours", "enabled", "onAssigned", "onCompletedByOther", "onDueSoon", "onOverdue", "quietFrom", "quietTo", "updatedAt", "userId" FROM "NotifyPreference";
DROP TABLE "NotifyPreference";
ALTER TABLE "new_NotifyPreference" RENAME TO "NotifyPreference";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentReaction_userId_idx" ON "CommentReaction"("userId");

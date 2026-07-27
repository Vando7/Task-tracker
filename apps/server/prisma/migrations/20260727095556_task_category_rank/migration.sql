-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'normal',
    "categoryRank" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "dueDate" DATETIME,
    "recurrenceEvery" INTEGER,
    "recurrenceUnit" TEXT,
    "recurrenceAnchor" TEXT NOT NULL DEFAULT 'completion',
    "rotateAssignees" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("category", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "recurrenceAnchor", "recurrenceEvery", "recurrenceUnit", "rotateAssignees", "status", "updatedAt", "workspaceId") SELECT "category", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "recurrenceAnchor", "recurrenceEvery", "recurrenceUnit", "rotateAssignees", "status", "updatedAt", "workspaceId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_workspaceId_deletedAt_status_categoryRank_updatedAt_idx" ON "Task"("workspaceId", "deletedAt", "status", "categoryRank", "updatedAt");
CREATE INDEX "Task_workspaceId_deletedAt_dueDate_idx" ON "Task"("workspaceId", "deletedAt", "dueDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

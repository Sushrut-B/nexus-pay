-- DropForeignKey
ALTER TABLE "expense_groups" DROP CONSTRAINT "expense_groups_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_createdByUserId_fkey";

-- AddForeignKey
ALTER TABLE "expense_groups" ADD CONSTRAINT "expense_groups_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

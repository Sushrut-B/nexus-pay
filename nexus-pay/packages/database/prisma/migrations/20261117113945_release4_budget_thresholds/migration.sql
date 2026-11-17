-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "thresholds" INTEGER[] DEFAULT ARRAY[50, 75, 90, 100]::INTEGER[];

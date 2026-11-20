-- AddForeignKey
ALTER TABLE "recharge_intents" ADD CONSTRAINT "recharge_intents_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "billers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

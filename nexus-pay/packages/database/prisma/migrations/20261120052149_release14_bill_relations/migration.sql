-- AddForeignKey
ALTER TABLE "bill_payment_intents" ADD CONSTRAINT "bill_payment_intents_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "billers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_intents" ADD CONSTRAINT "bill_payment_intents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "saved_biller_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

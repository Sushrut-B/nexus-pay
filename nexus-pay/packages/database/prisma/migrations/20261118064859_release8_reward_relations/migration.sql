-- AlterTable
ALTER TABLE "reward_campaigns" ADD COLUMN     "consumedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedMinor" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "reward_vouchers" ADD CONSTRAINT "reward_vouchers_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "reward_redemptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_budgets" ADD CONSTRAINT "campaign_budgets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "reward_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_tier_history" ADD CONSTRAINT "loyalty_tier_history_toTierId_fkey" FOREIGN KEY ("toTierId") REFERENCES "loyalty_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "referral_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_qualifications" ADD CONSTRAINT "referral_qualifications_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "referral_attributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

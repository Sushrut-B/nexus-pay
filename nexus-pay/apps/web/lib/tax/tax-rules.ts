import { prisma } from "@nexus/database";
import type { TaxRegime } from "@nexus/shared-types";

/** All monetary values are integer paise. Rates are integer basis points. */
export interface TaxSlabConfig { fromMinor: number; toMinor: number | null; rateBps: number; baseTaxMinor: number }
export interface TaxRuleConfig {
  version: string;
  financialYear: string;
  assessmentYear: string;
  regime: TaxRegime;
  slabs: TaxSlabConfig[];
  standardDeductionMinor: number;
  rebate: { maxMinor: number; incomeThresholdMinor: number; marginalRelief: boolean };
  surcharge: Array<{ incomeAboveMinor: number; rateBps: number }>;
  specialRateBps: number;
  cessBps: number;
  sourceRef: string;
  lastVerifiedAt: string;
  notes: string[];
}

const cr = (rupees: number) => rupees * 100;

const OLD_SLABS: TaxSlabConfig[] = [
  { fromMinor: 0, toMinor: cr(2_50_000), rateBps: 0, baseTaxMinor: 0 },
  { fromMinor: cr(2_50_000), toMinor: cr(5_00_000), rateBps: 500, baseTaxMinor: 0 },
  { fromMinor: cr(5_00_000), toMinor: cr(10_00_000), rateBps: 2000, baseTaxMinor: cr(12_500) },
  { fromMinor: cr(10_00_000), toMinor: null, rateBps: 3000, baseTaxMinor: cr(1_12_500) },
];

const OLD_SURCHARGE = [
  { incomeAboveMinor: cr(50_00_000), rateBps: 1000 },
  { incomeAboveMinor: cr(1_00_00_000), rateBps: 1500 },
  { incomeAboveMinor: cr(2_00_00_000), rateBps: 2500 },
  { incomeAboveMinor: cr(5_00_00_000), rateBps: 3700 },
];

const NEW_SURCHARGE = [
  { incomeAboveMinor: cr(50_00_000), rateBps: 1000 },
  { incomeAboveMinor: cr(1_00_00_000), rateBps: 1500 },
  { incomeAboveMinor: cr(2_00_00_000), rateBps: 2500 },
  { incomeAboveMinor: cr(5_00_00_000), rateBps: 2500 }, // capped under 115BAC
];

const SOURCE_2025 =
  "Income Tax Department — Tax slabs AY 2026-27 (incometax.gov.in/iec/foportal/help/individual/return-applicable-1); Threshold limits under Income Tax Act AY 2026-27 (incometaxindia.gov.in).";

const SOURCE_2024 =
  "Income Tax Department — Tax slabs AY 2025-26 (incometax.gov.in/iec/foportal/help/individual/return-applicable-3); Budget 2024 standard deduction announcement (PIB).";

export const TAX_RULE_CONFIGS: TaxRuleConfig[] = [
  {
    version: "ITD-FY2025-26-v1",
    financialYear: "2025-26",
    assessmentYear: "2026-27",
    regime: "NEW",
    slabs: [
      { fromMinor: 0, toMinor: cr(4_00_000), rateBps: 0, baseTaxMinor: 0 },
      { fromMinor: cr(4_00_000), toMinor: cr(8_00_000), rateBps: 500, baseTaxMinor: 0 },
      { fromMinor: cr(8_00_000), toMinor: cr(12_00_000), rateBps: 1000, baseTaxMinor: cr(20_000) },
      { fromMinor: cr(12_00_000), toMinor: cr(16_00_000), rateBps: 1500, baseTaxMinor: cr(60_000) },
      { fromMinor: cr(16_00_000), toMinor: cr(20_00_000), rateBps: 2000, baseTaxMinor: cr(1_20_000) },
      { fromMinor: cr(20_00_000), toMinor: cr(24_00_000), rateBps: 2500, baseTaxMinor: cr(2_00_000) },
      { fromMinor: cr(24_00_000), toMinor: null, rateBps: 3000, baseTaxMinor: cr(3_00_000) },
    ],
    standardDeductionMinor: cr(75_000),
    rebate: { maxMinor: cr(60_000), incomeThresholdMinor: cr(12_00_000), marginalRelief: true },
    surcharge: NEW_SURCHARGE,
    specialRateBps: 2000,
    cessBps: 400,
    sourceRef: SOURCE_2025,
    lastVerifiedAt: "2026-11-20",
    notes: ["New regime is default under section 115BAC(1A).", "Rebate 87A up to ₹60,000 for total income ≤ ₹12,00,000 with marginal relief.", "Health and education cess 4% on income tax plus surcharge."],
  },
  {
    version: "ITD-FY2025-26-v1",
    financialYear: "2025-26",
    assessmentYear: "2026-27",
    regime: "OLD",
    slabs: OLD_SLABS,
    standardDeductionMinor: cr(50_000),
    rebate: { maxMinor: cr(12_500), incomeThresholdMinor: cr(5_00_000), marginalRelief: false },
    surcharge: OLD_SURCHARGE,
    specialRateBps: 2000,
    cessBps: 400,
    sourceRef: SOURCE_2025,
    lastVerifiedAt: "2026-11-20",
    notes: ["Old regime allows deductions/exemptions.", "Rebate 87A up to ₹12,500 for total income ≤ ₹5,00,000."],
  },
  {
    version: "ITD-FY2024-25-v1",
    financialYear: "2024-25",
    assessmentYear: "2025-26",
    regime: "NEW",
    slabs: [
      { fromMinor: 0, toMinor: cr(3_00_000), rateBps: 0, baseTaxMinor: 0 },
      { fromMinor: cr(3_00_000), toMinor: cr(7_00_000), rateBps: 500, baseTaxMinor: 0 },
      { fromMinor: cr(7_00_000), toMinor: cr(10_00_000), rateBps: 1000, baseTaxMinor: cr(20_000) },
      { fromMinor: cr(10_00_000), toMinor: cr(12_00_000), rateBps: 1500, baseTaxMinor: cr(50_000) },
      { fromMinor: cr(12_00_000), toMinor: cr(15_00_000), rateBps: 2000, baseTaxMinor: cr(80_000) },
      { fromMinor: cr(15_00_000), toMinor: null, rateBps: 3000, baseTaxMinor: cr(1_40_000) },
    ],
    standardDeductionMinor: cr(75_000),
    rebate: { maxMinor: cr(25_000), incomeThresholdMinor: cr(7_00_000), marginalRelief: true },
    surcharge: NEW_SURCHARGE,
    specialRateBps: 2000,
    cessBps: 400,
    sourceRef: SOURCE_2024,
    lastVerifiedAt: "2026-11-20",
    notes: ["Rebate 87A up to ₹25,000 for total income ≤ ₹7,00,000 (AY 2025-26)."],
  },
  {
    version: "ITD-FY2024-25-v1",
    financialYear: "2024-25",
    assessmentYear: "2025-26",
    regime: "OLD",
    slabs: OLD_SLABS,
    standardDeductionMinor: cr(50_000),
    rebate: { maxMinor: cr(12_500), incomeThresholdMinor: cr(5_00_000), marginalRelief: false },
    surcharge: OLD_SURCHARGE,
    specialRateBps: 2000,
    cessBps: 400,
    sourceRef: SOURCE_2024,
    lastVerifiedAt: "2026-11-20",
    notes: ["Old regime slabs unchanged for AY 2025-26 and AY 2026-27 for individuals below 60."],
  },
];

export function getRuleConfig(financialYear: string, regime: TaxRegime): TaxRuleConfig {
  const config = TAX_RULE_CONFIGS.find((item) => item.financialYear === financialYear && item.regime === regime);
  if (!config) throw new Error(`No tax rule configuration for FY ${financialYear} (${regime}).`);
  return config;
}

export function supportedFinancialYears() {
  return Array.from(new Set(TAX_RULE_CONFIGS.map((item) => item.financialYear))).map((fy) => ({
    financialYear: fy,
    assessmentYear: TAX_RULE_CONFIGS.find((item) => item.financialYear === fy)!.assessmentYear,
    ruleSetVersion: TAX_RULE_CONFIGS.find((item) => item.financialYear === fy)!.version,
    sourceRef: TAX_RULE_CONFIGS.find((item) => item.financialYear === fy)!.sourceRef,
  }));
}

/** Seeds versioned DB rule sets for Control visibility. Idempotent. */
export async function seedTaxRuleSets() {
  const grouped = new Map<string, TaxRuleConfig[]>();
  for (const config of TAX_RULE_CONFIGS) {
    const list = grouped.get(config.version) ?? [];
    list.push(config);
    grouped.set(config.version, list);
  }
  for (const [version, configs] of grouped) {
    const first = configs[0]!;
    const existing = await prisma.taxRuleSet.findUnique({ where: { version } });
    if (existing) continue;
    await prisma.taxRuleSet.create({
      data: {
        version, financialYear: first.financialYear, assessmentYear: first.assessmentYear,
        status: "PUBLISHED", sourceRef: first.sourceRef,
        lastVerifiedAt: new Date(first.lastVerifiedAt), publishedAt: new Date(),
        slabs: { create: configs.flatMap((config) => config.slabs.map((slab) => ({
          regime: config.regime, fromMinor: slab.fromMinor, toMinor: slab.toMinor,
          rateBps: slab.rateBps, baseTaxMinor: slab.baseTaxMinor,
        }))) },
      },
    });
    await prisma.taxRuleSource.create({
      data: { ruleSetId: (await prisma.taxRuleSet.findUniqueOrThrow({ where: { version } })).id, title: "Income Tax Department official slab and threshold references", url: first.sourceRef, verifiedAt: new Date(first.lastVerifiedAt) },
    });
  }
}

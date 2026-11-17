import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });

const { prisma } = await import("../packages/database/src/index");
const { runDueExecutions } = await import("../apps/web/lib/finance/schedule-engine");

const result = await runDueExecutions(100);
console.log(`Scheduler run: ${JSON.stringify(result)}`);
await prisma.$disconnect();

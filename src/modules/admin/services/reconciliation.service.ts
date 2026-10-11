import { PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { AuditService, auditService } from "./audit.service";
import { logger } from "../../../infrastructure/logging/logger";

export interface ReconcileCountersResult {
  success: boolean;
  message: string;
}

export class ReconciliationService {
  constructor(
    private readonly audit: AuditService = auditService,
    private readonly db: PrismaClient = prisma
  ) {}

  /**
   * Recalculates all denormalized counters directly from relationship ground truth
   * via PostgreSQL stored procedure `reconcile_all_counters()`, and records an audit log.
   *
   * @param adminId Optional administrator ID executing the maintenance routine
   */
  async reconcileCounters(adminId?: string): Promise<ReconcileCountersResult> {
    logger.info({ adminId }, "Initiating counter reconciliation procedure");

    await this.db.$executeRaw`CALL reconcile_all_counters()`;

    if (adminId) {
      await this.audit.recordAction(
        adminId,
        "ADMIN_RECONCILED_COUNTERS",
        "SYSTEM",
        "COUNTERS",
        { timestamp: new Date().toISOString() }
      );
    }

    logger.info(
      { adminId },
      "Counter reconciliation procedure completed successfully"
    );

    return {
      success: true,
      message: "Counters reconciled successfully",
    };
  }
}

export const reconciliationService = new ReconciliationService();

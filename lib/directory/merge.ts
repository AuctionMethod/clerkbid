import type { AuctionDB, MasterBidder, MasterConsignor } from "@/lib/db";
import {
  parseDirectoryDate,
  type DirectoryExportPayload,
} from "@/lib/directory/payload";
import { consolidateDirectoryDuplicates } from "@/lib/directory/upsert";
import { normalizeEmail } from "@/lib/directory/match";
import { withCloudSyncApply } from "@/lib/db/syncApplyGuard";

function safeMs(d: Date | string | number | undefined | null): number {
  const parsed = d instanceof Date ? d : d != null ? new Date(d) : null;
  const t = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
  return t;
}

export type DirectoryMergeSummary = {
  biddersAdded: number;
  biddersUpdated: number;
  consignorsAdded: number;
  consignorsUpdated: number;
};

/**
 * Merge a vendor directory snapshot into local Dexie by `syncKey`,
 * preferring email uniqueness when a remote row shares an email with a
 * local row that has a different syncKey. Last-write-wins per record.
 * Local-only rows are kept, then email duplicates are consolidated.
 */
export async function mergeDirectorySnapshot(
  db: AuctionDB,
  remote: DirectoryExportPayload
): Promise<DirectoryMergeSummary> {
  const summary: DirectoryMergeSummary = {
    biddersAdded: 0,
    biddersUpdated: 0,
    consignorsAdded: 0,
    consignorsUpdated: 0,
  };

  await db.transaction("rw", [db.masterBidders, db.masterConsignors], async () => {
    const localBidders = await db.masterBidders.toArray();
    const bidderByKey = new Map<string, MasterBidder>();
    const bidderByEmail = new Map<string, MasterBidder>();
    for (const b of localBidders) {
      bidderByKey.set(b.syncKey, b);
      const e = normalizeEmail(b.email);
      if (e && !bidderByEmail.has(e)) bidderByEmail.set(e, b);
    }

    for (const rb of remote.bidders) {
      const remoteUpdated = parseDirectoryDate(rb.updatedAt);
      const remoteEmail = normalizeEmail(rb.email);
      const local =
        bidderByKey.get(rb.syncKey) ??
        (remoteEmail ? bidderByEmail.get(remoteEmail) : undefined);

      if (!local) {
        await db.masterBidders.add({
          syncKey: rb.syncKey,
          firstName: rb.firstName,
          lastName: rb.lastName,
          phone: rb.phone,
          email: rb.email,
          mailingAddress: rb.mailingAddress,
          resaleNumber: rb.resaleNumber,
          createdAt: parseDirectoryDate(rb.createdAt),
          updatedAt: remoteUpdated,
        });
        summary.biddersAdded++;
      } else if (safeMs(remoteUpdated) > safeMs(local.updatedAt) && local.id != null) {
        await db.masterBidders.update(local.id, {
          firstName: rb.firstName,
          lastName: rb.lastName,
          phone: rb.phone,
          email: rb.email,
          mailingAddress: rb.mailingAddress,
          resaleNumber: rb.resaleNumber,
          updatedAt: remoteUpdated,
        });
        summary.biddersUpdated++;
      }
    }

    const localConsignors = await db.masterConsignors.toArray();
    const consignorByKey = new Map<string, MasterConsignor>();
    const consignorByEmail = new Map<string, MasterConsignor>();
    for (const c of localConsignors) {
      consignorByKey.set(c.syncKey, c);
      const e = normalizeEmail(c.email);
      if (e && !consignorByEmail.has(e)) consignorByEmail.set(e, c);
    }

    for (const rc of remote.consignors) {
      const remoteUpdated = parseDirectoryDate(rc.updatedAt);
      const remoteEmail = normalizeEmail(rc.email);
      const local =
        consignorByKey.get(rc.syncKey) ??
        (remoteEmail ? consignorByEmail.get(remoteEmail) : undefined);

      if (!local) {
        await db.masterConsignors.add({
          syncKey: rc.syncKey,
          name: rc.name,
          email: rc.email,
          phone: rc.phone,
          mailingAddress: rc.mailingAddress,
          notes: rc.notes,
          commissionRate: rc.commissionRate,
          createdAt: parseDirectoryDate(rc.createdAt),
          updatedAt: remoteUpdated,
        });
        summary.consignorsAdded++;
      } else if (safeMs(remoteUpdated) > safeMs(local.updatedAt) && local.id != null) {
        await db.masterConsignors.update(local.id, {
          name: rc.name,
          email: rc.email,
          phone: rc.phone,
          mailingAddress: rc.mailingAddress,
          notes: rc.notes,
          commissionRate: rc.commissionRate,
          updatedAt: remoteUpdated,
        });
        summary.consignorsUpdated++;
      }
    }
  });

  await withCloudSyncApply(async () => {
    await consolidateDirectoryDuplicates(db);
  });

  return summary;
}

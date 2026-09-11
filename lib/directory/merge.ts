import type { AuctionDB, MasterBidder, MasterConsignor } from "@/lib/db";
import {
  parseDirectoryDate,
  type DirectoryExportPayload,
} from "@/lib/directory/payload";

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
 * Merge a vendor directory snapshot into local Dexie by `syncKey`.
 * Last-write-wins per record (`updatedAt`). Local-only rows are kept.
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
    for (const b of localBidders) bidderByKey.set(b.syncKey, b);

    for (const rb of remote.bidders) {
      const local = bidderByKey.get(rb.syncKey);
      const remoteUpdated = parseDirectoryDate(rb.updatedAt);
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
    for (const c of localConsignors) consignorByKey.set(c.syncKey, c);

    for (const rc of remote.consignors) {
      const local = consignorByKey.get(rc.syncKey);
      const remoteUpdated = parseDirectoryDate(rc.updatedAt);
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

  return summary;
}

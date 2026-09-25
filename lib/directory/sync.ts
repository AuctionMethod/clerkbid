import type { AuctionDB } from "@/lib/db";
import { ensureSettingsRow } from "@/lib/settings";
import {
  buildDirectoryExport,
  isDirectoryExportPayload,
  type DirectoryExportPayload,
} from "@/lib/directory/payload";
import { mergeDirectorySnapshot } from "@/lib/directory/merge";
import { consolidateDirectoryDuplicates } from "@/lib/directory/upsert";
import { withCloudSyncApply } from "@/lib/db/syncApplyGuard";

function isNewer(serverIso: string, local?: Date): boolean {
  const serverMs = new Date(serverIso).getTime();
  if (!Number.isFinite(serverMs)) return false;
  if (local == null) return true;
  return serverMs > local.getTime();
}

export async function fetchDirectorySnapshot(): Promise<
  | { ok: true; payload: DirectoryExportPayload; updatedAt: string }
  | { ok: false; status: number; missing?: boolean }
> {
  const res = await fetch("/api/sync/directory/", {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 404) return { ok: false, status: 404, missing: true };
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { payload: unknown; updatedAt: string };
  if (!isDirectoryExportPayload(data.payload)) {
    return { ok: false, status: 422 };
  }
  return { ok: true, payload: data.payload, updatedAt: data.updatedAt };
}

export async function pushDirectorySnapshot(
  payload: DirectoryExportPayload
): Promise<
  | { ok: true; updatedAt: string; unchanged?: boolean }
  | { ok: false; status: number }
> {
  const res = await fetch("/api/sync/directory/", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload,
      clientExportedAt: payload.exportDate,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { updatedAt: string; unchanged?: boolean };
  return { ok: true, updatedAt: data.updatedAt, unchanged: data.unchanged };
}

export async function pullDirectoryFromCloud(db: AuctionDB): Promise<boolean> {
  const snap = await fetchDirectorySnapshot();
  if (!snap.ok) return snap.missing === true;
  await ensureSettingsRow(db);
  const settings = await db.settings.get(1);
  if (
    !isNewer(snap.updatedAt, settings?.lastDirectoryPullAt) &&
    !isNewer(snap.updatedAt, settings?.lastDirectoryPushAt)
  ) {
    return true;
  }
  await mergeDirectorySnapshot(db, snap.payload);
  const t = new Date(snap.updatedAt);
  await db.settings.update(1, { lastDirectoryPullAt: t });
  return true;
}

export async function pushDirectoryToCloud(db: AuctionDB): Promise<boolean> {
  const [bidders, consignors] = await Promise.all([
    db.masterBidders.toArray(),
    db.masterConsignors.toArray(),
  ]);
  if (bidders.length === 0 && consignors.length === 0) {
    const existing = await fetchDirectorySnapshot();
    if (!existing.ok) return existing.missing === true || existing.status === 404;
  }
  const payload = await buildDirectoryExport(bidders, consignors);
  const result = await pushDirectorySnapshot(payload);
  if (!result.ok) return false;
  const t = new Date(result.updatedAt);
  await ensureSettingsRow(db);
  await db.settings.update(1, {
    lastDirectoryPushAt: t,
    lastDirectoryPullAt: t,
  });
  return true;
}

/**
 * Collapse email/phone duplicate master rows and push the cleaned Directory
 * to cloud when anything was removed (so sync does not resurrect them).
 */
export async function cleanupDirectoryDuplicates(
  db: AuctionDB
): Promise<{
  biddersRemoved: number;
  consignorsRemoved: number;
  pushed: boolean;
}> {
  const result = await withCloudSyncApply(async () =>
    consolidateDirectoryDuplicates(db)
  );
  let pushed = false;
  if (result.biddersRemoved > 0 || result.consignorsRemoved > 0) {
    try {
      pushed = await pushDirectoryToCloud(db);
    } catch {
      pushed = false;
    }
  }
  return { ...result, pushed };
}

export async function syncDirectoryWithCloud(db: AuctionDB): Promise<void> {
  try {
    await pullDirectoryFromCloud(db);
  } catch {
    /* network */
  }
  try {
    // Always collapse local dupes after pull (and push if we removed any).
    await cleanupDirectoryDuplicates(db);
  } catch {
    /* ignore */
  }
  try {
    await pushDirectoryToCloud(db);
  } catch {
    /* network */
  }
}

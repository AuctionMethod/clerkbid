import type { AuctionDB, MasterBidder, MasterConsignor } from "@/lib/db";
import { newEntitySyncKey } from "@/lib/utils/clientSyncKey";
import { digitsOnly, normalizeEmail, optTrim } from "@/lib/directory/match";

export type MasterBidderFields = {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  mailingAddress?: string;
  resaleNumber?: string;
};

export type MasterConsignorFields = {
  name: string;
  email?: string;
  phone?: string;
  mailingAddress?: string;
  notes?: string;
  commissionRate?: number;
};

function samePhone(
  a: string | undefined,
  b: string | undefined
): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  return da.length >= 7 && da === db;
}

function safeMs(d: Date | string | number | undefined | null): number {
  const parsed = d instanceof Date ? d : d != null ? new Date(d) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
}

export async function findMasterBidder(
  db: AuctionDB,
  fields: Pick<MasterBidderFields, "email" | "phone">
): Promise<MasterBidder | undefined> {
  const email = normalizeEmail(fields.email);
  const all = await db.masterBidders.toArray();
  if (email) {
    const byEmail = all.find((m) => normalizeEmail(m.email) === email);
    if (byEmail) return byEmail;
  }
  if (digitsOnly(fields.phone).length >= 7) {
    return all.find((m) => samePhone(m.phone, fields.phone));
  }
  return undefined;
}

export async function findMasterConsignor(
  db: AuctionDB,
  fields: Pick<MasterConsignorFields, "email" | "phone">
): Promise<MasterConsignor | undefined> {
  const email = normalizeEmail(fields.email);
  const all = await db.masterConsignors.toArray();
  if (email) {
    const byEmail = all.find((m) => normalizeEmail(m.email) === email);
    if (byEmail) return byEmail;
  }
  if (digitsOnly(fields.phone).length >= 7) {
    return all.find((m) => samePhone(m.phone, fields.phone));
  }
  return undefined;
}

function bidderPatch(
  fields: MasterBidderFields,
  now: Date
): Omit<MasterBidder, "id" | "syncKey" | "createdAt"> {
  return {
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    resaleNumber: optTrim(fields.resaleNumber),
    updatedAt: now,
  };
}

function consignorPatch(
  fields: MasterConsignorFields,
  now: Date
): Partial<MasterConsignor> {
  const patch: Partial<MasterConsignor> = {
    name: fields.name.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    notes: optTrim(fields.notes),
    updatedAt: now,
  };
  if (fields.commissionRate !== undefined) {
    patch.commissionRate = fields.commissionRate;
  }
  return patch;
}

async function repointBidderMasterLinks(
  db: AuctionDB,
  fromSyncKey: string,
  toSyncKey: string
): Promise<void> {
  if (fromSyncKey === toSyncKey) return;
  const linked = await db.bidders.where("masterSyncKey").equals(fromSyncKey).toArray();
  for (const b of linked) {
    if (b.id != null) {
      await db.bidders.update(b.id, { masterSyncKey: toSyncKey });
    }
  }
}

async function repointConsignorMasterLinks(
  db: AuctionDB,
  fromSyncKey: string,
  toSyncKey: string
): Promise<void> {
  if (fromSyncKey === toSyncKey) return;
  const linked = await db.consignors
    .where("masterSyncKey")
    .equals(fromSyncKey)
    .toArray();
  for (const c of linked) {
    if (c.id != null) {
      await db.consignors.update(c.id, { masterSyncKey: toSyncKey });
    }
  }
}

/**
 * Find by email (preferred), else preferredSyncKey, else phone.
 * Updates the matched master with the latest fields so Directory stays current.
 * If email matches a different record than preferredSyncKey, merges into the
 * email-canonical row and removes the preferred duplicate.
 */
export async function upsertMasterBidder(
  db: AuctionDB,
  fields: MasterBidderFields,
  options?: { preferredSyncKey?: string; now?: Date }
): Promise<MasterBidder> {
  const now = options?.now ?? new Date();
  const email = normalizeEmail(fields.email);
  const all = await db.masterBidders.toArray();
  const preferred = options?.preferredSyncKey
    ? all.find((m) => m.syncKey === options.preferredSyncKey)
    : undefined;

  let existing: MasterBidder | undefined;
  if (email) {
    existing = all.find((m) => normalizeEmail(m.email) === email);
  }
  if (!existing && preferred) existing = preferred;
  if (!existing && digitsOnly(fields.phone).length >= 7) {
    existing = all.find((m) => samePhone(m.phone, fields.phone));
  }

  const patch = bidderPatch(fields, now);

  if (existing?.id != null) {
    if (
      preferred &&
      preferred.id != null &&
      preferred.syncKey !== existing.syncKey
    ) {
      await repointBidderMasterLinks(db, preferred.syncKey, existing.syncKey);
      await db.masterBidders.delete(preferred.id);
    }
    await db.masterBidders.update(existing.id, patch);
    return { ...existing, ...patch, id: existing.id };
  }

  const row: MasterBidder = {
    syncKey: preferred?.syncKey ?? newEntitySyncKey(),
    ...patch,
    createdAt: now,
  };
  const id = (await db.masterBidders.add(row)) as number;
  return { ...row, id };
}

/**
 * @deprecated Prefer upsertMasterBidder — kept as an alias that updates on match.
 */
export async function findOrCreateMasterBidder(
  db: AuctionDB,
  fields: MasterBidderFields,
  now: Date = new Date()
): Promise<MasterBidder> {
  return upsertMasterBidder(db, fields, { now });
}

export async function upsertMasterConsignor(
  db: AuctionDB,
  fields: MasterConsignorFields,
  options?: { preferredSyncKey?: string; now?: Date }
): Promise<MasterConsignor> {
  const now = options?.now ?? new Date();
  const email = normalizeEmail(fields.email);
  const all = await db.masterConsignors.toArray();
  const preferred = options?.preferredSyncKey
    ? all.find((m) => m.syncKey === options.preferredSyncKey)
    : undefined;

  let existing: MasterConsignor | undefined;
  if (email) {
    existing = all.find((m) => normalizeEmail(m.email) === email);
  }
  if (!existing && preferred) existing = preferred;
  if (!existing && digitsOnly(fields.phone).length >= 7) {
    existing = all.find((m) => samePhone(m.phone, fields.phone));
  }

  const patch = consignorPatch(fields, now);

  if (existing?.id != null) {
    if (
      preferred &&
      preferred.id != null &&
      preferred.syncKey !== existing.syncKey
    ) {
      await repointConsignorMasterLinks(db, preferred.syncKey, existing.syncKey);
      await db.masterConsignors.delete(preferred.id);
    }
    await db.masterConsignors.update(existing.id, patch);
    return { ...existing, ...patch, id: existing.id };
  }

  const row: MasterConsignor = {
    syncKey: preferred?.syncKey ?? newEntitySyncKey(),
    name: fields.name.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    notes: optTrim(fields.notes),
    commissionRate: fields.commissionRate,
    createdAt: now,
    updatedAt: now,
  };
  const id = (await db.masterConsignors.add(row)) as number;
  return { ...row, id };
}

export async function findOrCreateMasterConsignor(
  db: AuctionDB,
  fields: MasterConsignorFields,
  now: Date = new Date()
): Promise<MasterConsignor> {
  return upsertMasterConsignor(db, fields, { now });
}

export async function updateMasterBidderFromEvent(
  db: AuctionDB,
  masterSyncKey: string,
  fields: MasterBidderFields,
  now: Date = new Date()
): Promise<boolean> {
  const row = await upsertMasterBidder(db, fields, {
    preferredSyncKey: masterSyncKey,
    now,
  });
  return row.id != null;
}

export async function updateMasterConsignorFromEvent(
  db: AuctionDB,
  masterSyncKey: string,
  fields: MasterConsignorFields,
  now: Date = new Date()
): Promise<boolean> {
  const row = await upsertMasterConsignor(db, fields, {
    preferredSyncKey: masterSyncKey,
    now,
  });
  return row.id != null;
}

/**
 * Collapse master bidders that share the same normalized email into one row.
 * Keeps the newest `updatedAt`, re-points event links, deletes the rest.
 */
export async function consolidateMasterBiddersByEmail(
  db: AuctionDB
): Promise<{ removed: number }> {
  const all = await db.masterBidders.toArray();
  const byEmail = new Map<string, MasterBidder[]>();
  for (const m of all) {
    const e = normalizeEmail(m.email);
    if (!e) continue;
    const list = byEmail.get(e) ?? [];
    list.push(m);
    byEmail.set(e, list);
  }

  let removed = 0;
  for (const [, group] of byEmail) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const byUpdated = safeMs(b.updatedAt) - safeMs(a.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return safeMs(a.createdAt) - safeMs(b.createdAt);
    });
    const winner = group[0]!;
    const losers = group.slice(1);
    for (const loser of losers) {
      await repointBidderMasterLinks(db, loser.syncKey, winner.syncKey);
      if (loser.id != null) {
        await db.masterBidders.delete(loser.id);
        removed++;
      }
    }
  }
  return { removed };
}

export async function consolidateMasterConsignorsByEmail(
  db: AuctionDB
): Promise<{ removed: number }> {
  const all = await db.masterConsignors.toArray();
  const byEmail = new Map<string, MasterConsignor[]>();
  for (const m of all) {
    const e = normalizeEmail(m.email);
    if (!e) continue;
    const list = byEmail.get(e) ?? [];
    list.push(m);
    byEmail.set(e, list);
  }

  let removed = 0;
  for (const [, group] of byEmail) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const byUpdated = safeMs(b.updatedAt) - safeMs(a.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return safeMs(a.createdAt) - safeMs(b.createdAt);
    });
    const winner = group[0]!;
    const losers = group.slice(1);
    for (const loser of losers) {
      await repointConsignorMasterLinks(db, loser.syncKey, winner.syncKey);
      if (loser.id != null) {
        await db.masterConsignors.delete(loser.id);
        removed++;
      }
    }
  }
  return { removed };
}

export async function consolidateDirectoryDuplicates(
  db: AuctionDB
): Promise<{ biddersRemoved: number; consignorsRemoved: number }> {
  const bidders = await consolidateMasterBiddersByEmail(db);
  const consignors = await consolidateMasterConsignorsByEmail(db);
  return {
    biddersRemoved: bidders.removed,
    consignorsRemoved: consignors.removed,
  };
}

export async function findEventBidderByMaster(
  db: AuctionDB,
  eventId: number,
  masterSyncKey: string
) {
  return db.bidders
    .where("[eventId+masterSyncKey]")
    .equals([eventId, masterSyncKey])
    .first();
}

export async function findEventConsignorByMaster(
  db: AuctionDB,
  eventId: number,
  masterSyncKey: string
) {
  return db.consignors
    .where("[eventId+masterSyncKey]")
    .equals([eventId, masterSyncKey])
    .first();
}

export function masterBidderFieldsDiffer(
  master: MasterBidder,
  fields: MasterBidderFields
): boolean {
  return (
    master.firstName.trim() !== fields.firstName.trim() ||
    master.lastName.trim() !== fields.lastName.trim() ||
    (optTrim(master.phone) ?? "") !== (optTrim(fields.phone) ?? "") ||
    (optTrim(master.email) ?? "") !== (optTrim(fields.email) ?? "") ||
    (optTrim(master.mailingAddress) ?? "") !==
      (optTrim(fields.mailingAddress) ?? "") ||
    (optTrim(master.resaleNumber) ?? "") !== (optTrim(fields.resaleNumber) ?? "")
  );
}

export function masterConsignorFieldsDiffer(
  master: MasterConsignor,
  fields: MasterConsignorFields
): boolean {
  const masterPct = master.commissionRate;
  const fieldPct = fields.commissionRate;
  const commissionDiff =
    masterPct !== fieldPct &&
    !(masterPct == null && fieldPct == null);
  return (
    master.name.trim() !== fields.name.trim() ||
    (optTrim(master.phone) ?? "") !== (optTrim(fields.phone) ?? "") ||
    (optTrim(master.email) ?? "") !== (optTrim(fields.email) ?? "") ||
    (optTrim(master.mailingAddress) ?? "") !==
      (optTrim(fields.mailingAddress) ?? "") ||
    (optTrim(master.notes) ?? "") !== (optTrim(fields.notes) ?? "") ||
    commissionDiff
  );
}

import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Dexie from "dexie";
import { AuctionDB } from "@/lib/db";
import { seedDirectoryFromEvents } from "@/lib/directory/seed";
import { mergeDirectorySnapshot } from "@/lib/directory/merge";
import { findOrCreateMasterBidder } from "@/lib/directory/upsert";
import { ensureSettingsRow } from "@/lib/settings";
import { DIRECTORY_EXPORT_VERSION } from "@/lib/directory/payload";

let db: AuctionDB;

beforeEach(async () => {
  const uid = `dir_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  db = new AuctionDB(uid);
  await ensureSettingsRow(db);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe("directory seed and upsert", () => {
  it("matches existing event bidders by email into one master", async () => {
    const eventId = (await db.events.add({
      name: "A",
      organizationName: "Org",
      taxRate: 0,
      buyersPremiumRate: 0,
      defaultConsignorCommissionRate: 0,
      currencySymbol: "$",
      syncId: "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee",
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as number;
    const event2 = (await db.events.add({
      name: "B",
      organizationName: "Org",
      taxRate: 0,
      buyersPremiumRate: 0,
      defaultConsignorCommissionRate: 0,
      currencySymbol: "$",
      syncId: "aaaaaaaa-bbbb-1ccc-8ddd-ffffffffffff",
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as number;
    const now = new Date();
    await db.bidders.add({
      eventId,
      paddleNumber: 1,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@x.com",
      createdAt: now,
      updatedAt: now,
    });
    await db.bidders.add({
      eventId: event2,
      paddleNumber: 9,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@x.com",
      createdAt: now,
      updatedAt: now,
    });

    await seedDirectoryFromEvents(db);
    const masters = await db.masterBidders.toArray();
    expect(masters).toHaveLength(1);
    const linked = await db.bidders.toArray();
    expect(linked.every((b) => b.masterSyncKey === masters[0]?.syncKey)).toBe(
      true
    );
  });

  it("does not merge name-only duplicates", async () => {
    const eventId = (await db.events.add({
      name: "A",
      organizationName: "Org",
      taxRate: 0,
      buyersPremiumRate: 0,
      defaultConsignorCommissionRate: 0,
      currencySymbol: "$",
      syncId: "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee",
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as number;
    const now = new Date();
    await db.bidders.add({
      eventId,
      paddleNumber: 1,
      firstName: "Pat",
      lastName: "Lee",
      createdAt: now,
      updatedAt: now,
    });
    await db.bidders.add({
      eventId,
      paddleNumber: 2,
      firstName: "Pat",
      lastName: "Lee",
      createdAt: now,
      updatedAt: now,
    });
    await seedDirectoryFromEvents(db);
    expect(await db.masterBidders.count()).toBe(2);
  });

  it("findOrCreate reuses email match", async () => {
    const a = await findOrCreateMasterBidder(db, {
      firstName: "A",
      lastName: "B",
      email: "ab@x.com",
    });
    const b = await findOrCreateMasterBidder(db, {
      firstName: "Other",
      lastName: "Name",
      email: "ab@x.com",
    });
    expect(b.syncKey).toBe(a.syncKey);
    expect(await db.masterBidders.count()).toBe(1);
  });
});

describe("mergeDirectorySnapshot", () => {
  it("adds remote-only records and updates when remote is newer", async () => {
    await db.masterBidders.add({
      syncKey: "same",
      firstName: "Old",
      lastName: "Name",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const summary = await mergeDirectorySnapshot(db, {
      exportVersion: DIRECTORY_EXPORT_VERSION,
      exportDate: "2026-02-01T00:00:00.000Z",
      bidders: [
        {
          syncKey: "same",
          firstName: "New",
          lastName: "Name",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
        {
          syncKey: "extra",
          firstName: "Ada",
          lastName: "Lovelace",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      consignors: [],
    });
    expect(summary.biddersAdded).toBe(1);
    expect(summary.biddersUpdated).toBe(1);
    const same = await db.masterBidders.where("syncKey").equals("same").first();
    expect(same?.firstName).toBe("New");
  });
});

import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { devLogin, getState } from "../helpers";
import { randomUUID } from "crypto";

test.describe("Sessions tab", () => {
  let db: Client;
  let devUserID: string;

  test.beforeAll(async () => {
    const { dbUrl } = getState();
    db = new Client({ connectionString: dbUrl });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.end();
  });

  test.beforeEach(async ({ page }) => {
    await devLogin(page);
    const res = await db.query(
      "SELECT id FROM users WHERE external_id = 'dev-agent-smith'",
    );
    devUserID = res.rows[0].id;
  });

  test("shows empty state when no sessions", async ({ page }) => {
    await page.click("#tab-sessions");
    const table = page.locator("#sessions-table-wrap");
    await expect(table).toBeVisible({ timeout: 5000 });
    await expect(table).toContainText("No sessions");
  });

  test("displays seeded session in table", async ({ page }) => {
    const deviceId = randomUUID();
    const serviceId = randomUUID();
    const sessionId = randomUUID();

    await db.query(
      `INSERT INTO devices (id, owner_user_id, hostname, status, credential_hash,
         agent_version, os_platform, os_version, os_arch, kernel_version,
         cpu_model, cpu_cores, total_memory_bytes, disk_total_bytes, disk_free_bytes)
       VALUES ($1, $2, 'session-device', 'active', 'fakehash',
         '0.1.0', 'linux', '6.1', 'amd64', '6.1.0',
         'Intel i7', 8, 17179869184, 500000000000, 250000000000)`,
      [deviceId, devUserID],
    );

    await db.query(
      `INSERT INTO services (id, device_id, name, protocol, local_bind, exposure_type)
       VALUES ($1, $2, 'ssh', 'tcp', '127.0.0.1:22', 'tcp')`,
      [serviceId, deviceId],
    );

    await db.query(
      `INSERT INTO connect_sessions (id, requester_user_id, target_device_id,
         target_service_id, requested_action, status, expires_at)
       VALUES ($1, $2, $3, $4, 'connect', 'pending',
         now() + interval '1 hour')`,
      [sessionId, devUserID, deviceId, serviceId],
    );

    await page.click("#tab-sessions");
    await page.waitForSelector("#sessions-table-wrap:not(.hidden)", {
      timeout: 5000,
    });

    const row = page.locator("#sessions-body tr").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("pending");
    await expect(row).toContainText("connect");

    // Clean up.
    await db.query("DELETE FROM connect_sessions WHERE id = $1", [sessionId]);
    await db.query("DELETE FROM services WHERE id = $1", [serviceId]);
    await db.query("DELETE FROM devices WHERE id = $1", [deviceId]);
  });
});

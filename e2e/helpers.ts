import { type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const STATE_FILE = join(__dirname, ".e2e-state.json");

export function getState(): {
  baseURL: string;
  dbUrl: string;
  port: number;
} {
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}

/** Navigate to dev-login and land on /admin with a valid JWT. */
export async function devLogin(page: Page) {
  const state = getState();
  await page.goto(`${state.baseURL}/auth/dev-login`);
  await page.waitForURL("**/admin**", { timeout: 5000 });
  await page.waitForSelector("#user-email", { timeout: 5000 });
}

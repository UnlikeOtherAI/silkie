import { test, expect } from "@playwright/test";
import { devLogin, getState } from "../helpers";

test.describe("Auth", () => {
  test("login page shows dev login button", async ({ page }) => {
    const { baseURL } = getState();
    await page.goto(`${baseURL}/login`);
    const devBtn = page.locator("#dev-login-btn");
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await expect(devBtn).toHaveText("Dev Login");
  });

  test("dev login redirects to admin with valid JWT", async ({ page }) => {
    await devLogin(page);
    expect(page.url()).toContain("/admin");
    const userInfo = page.locator("#user-email");
    await expect(userInfo).toContainText("Agent Smith");
  });

  test("dev login shows avatar", async ({ page }) => {
    await devLogin(page);
    const avatar = page.locator("#user-avatar");
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute("src", /dicebear.*AgentSmith/);
  });

  test("sign out clears token and redirects to login", async ({ page }) => {
    await devLogin(page);
    await page.click("button[title='Sign out']");
    await page.waitForURL("**/login", { timeout: 5000 });
    expect(page.url()).toContain("/login");
  });
});

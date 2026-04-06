import { test, expect } from "@playwright/test";
import { getState } from "../helpers";

test("server is running and healthy", async ({ request }) => {
  const { baseURL } = getState();
  const resp = await request.get(`${baseURL}/healthz`);
  expect(resp.ok()).toBeTruthy();
  expect(await resp.text()).toBe("ok");
});

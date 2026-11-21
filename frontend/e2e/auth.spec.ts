import { expect, test } from "@playwright/test";
import { AUTH_URL } from "./helpers";

const PASSWORD = "e2e-password-123";
test.use({ baseURL: AUTH_URL });

async function login(page: import("@playwright/test").Page, password = PASSWORD) {
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

test("chưa đăng nhập: chỉ thấy form, API bị chặn", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
  await expect(page.getByLabel("Link YouTube")).toHaveCount(0);
  expect((await request.get("/api/jobs")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("sai mật khẩu báo lỗi; đúng thì vào app và giữ phiên sau khi tải lại; đăng xuất", async ({ page }) => {
  await page.goto("/");
  await login(page, "sai-mat-khau");
  await expect(page.getByRole("alert")).toContainText("Sai mật khẩu");
  await login(page);
  await expect(page.getByLabel("Link YouTube")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Link YouTube")).toBeVisible(); // cookie phiên còn hiệu lực

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByRole("button", { name: /đăng xuất/i }).click();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
});

test("cookie phiên: HttpOnly + SameSite=Lax", async ({ page, context }) => {
  await page.goto("/");
  await login(page);
  await expect(page.getByLabel("Link YouTube")).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === "ytmp3_session");
  expect(cookie).toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("ytmp3_session"); // JS không đọc được
});

test("token API: tạo (hiện một lần) → dùng Bearer thêm job → thu hồi thì bị từ chối", async ({ page, request }) => {
  await page.goto("/");
  await login(page);
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByLabel("Tên token").fill("E2E shortcut");
  await page.getByRole("button", { name: /^Tạo$/ }).click();
  const token = (await page.getByTestId("new-token").textContent())!.trim();
  expect(token).toMatch(/^ytm_/);

  const auth = { Authorization: `Bearer ${token}` };
  const created = await request.post("/api/jobs", { headers: auth, data: { url: "https://youtu.be/dQw4w9WgXcQ" } });
  expect(created.status()).toBe(201);

  await page.getByRole("button", { name: "Thu hồi E2E shortcut" }).click();
  await expect(page.getByText("E2E shortcut")).toHaveCount(0);
  expect((await request.get("/api/jobs", { headers: auth })).status()).toBe(401);
});

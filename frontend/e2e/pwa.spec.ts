import { expect, test } from "@playwright/test";
import { reset, ytUrl, toast } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("manifest hợp lệ: cài được, có icon maskable, shortcuts và share_target", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({ display: "standalone", start_url: "/", scope: "/", lang: "vi" });
  expect(m.name).toBeTruthy();
  expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`)).toEqual(
    expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]),
  );
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
  }
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/?tab=download", "/?tab=history"]);
  expect(m.share_target).toMatchObject({ method: "GET", params: { url: "url", text: "text" } });

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});

test("service worker kích hoạt và kiểm soát trang", async ({ page }) => {
  await page.goto("/");
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(script).toMatch(/\/sw\.js$/);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});

test("mất mạng: mở lại vẫn ra app, báo offline, khóa nút thêm link", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload(); // để SW kiểm soát trang
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "YT → MP3" })).toBeVisible();
  await expect(page.getByText(/Không có kết nối mạng/)).toBeVisible();
  await page.getByLabel("Link YouTube").fill(ytUrl("dQw4w9WgXcQ"));
  await expect(page.getByRole("button", { name: /thêm vào hàng đợi/i })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: /thêm vào hàng đợi/i })).toBeEnabled();
});

test("API không bao giờ bị service worker trả từ cache", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  const first = await page.evaluate(async () => (await fetch("/api/jobs")).json());
  await page.request.post("/api/jobs", { data: { url: ytUrl("slowAAAAAAA") } });
  const second = await page.evaluate(async () => (await fetch("/api/jobs")).json());
  expect(first.total).toBe(0);
  expect(second.total).toBe(1);
});

test("Share Target: mở /?url=…&text=… từ app khác tự thêm vào hàng đợi", async ({ page }) => {
  await page.goto(`/?title=Hay&text=${encodeURIComponent("Nghe bài này " + ytUrl("dQw4w9WgXcQ"))}`);
  await expect(toast(page, "Đã thêm vào hàng đợi")).toBeVisible();
  expect(new URL(page.url()).search).toBe(""); // tham số được xóa khỏi thanh địa chỉ
});

test("deep link ?url= (Shortcut/bookmarklet) và ?tab=history (shortcut của PWA)", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent(ytUrl("dQw4w9WgXcQ"))}`);
  await expect(toast(page, "Tải xong")).toBeVisible();
  await page.goto("/?tab=history");
  await expect(page.getByRole("region", { name: "Lịch sử" })).toBeVisible();
});

test("cài đặt → thông báo: có công tắc (chưa bật) trên trình duyệt hỗ trợ push", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("switch", { name: "Thông báo trên thiết bị này" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Thông báo trên thiết bị này" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

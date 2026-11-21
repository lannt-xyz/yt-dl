import { type APIRequestContext, type Locator, type Page, expect } from "@playwright/test";

export const AUTH_URL = "http://localhost:8802";
export const ytUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const titleOf = (id: string) => `Video thử ${id}`;

export async function reset(request: APIRequestContext) {
  const res = await request.post("/api/_test/reset");
  expect(res.ok()).toBeTruthy();
}

/** Dán link vào ô nhập rồi bấm thêm vào hàng đợi. */
export async function addUrl(page: Page, id: string) {
  await page.getByLabel("Link YouTube").fill(ytUrl(id));
  await page.getByRole("button", { name: /thêm vào hàng đợi/i }).click();
}

export async function bottomNavVisible(page: Page) {
  return page.getByRole("navigation", { name: "Điều hướng chính" }).isVisible();
}

/** Trên điện thoại/iPad dọc: chuyển sang tab Lịch sử; trên màn rộng thì lịch sử luôn hiển thị. */
export async function openHistory(page: Page) {
  if (await bottomNavVisible(page)) {
    await page.getByRole("button", { name: /Lịch sử/ }).click();
  }
  await expect(page.getByRole("region", { name: "Lịch sử" })).toBeVisible();
}

export async function openDownloadTab(page: Page) {
  if (await bottomNavVisible(page)) {
    await page.getByRole("button", { name: /Tải về/ }).click();
  }
}

export const cardFor = (page: Page, id: string): Locator =>
  page.getByRole("article").filter({ hasText: titleOf(id) });

export async function noHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, `trang tràn ngang: scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner);
}

/** Toast có đúng tiêu đề này (so khớp chính xác, tránh khớp nhầm nội dung toast khác như "…khi tải xong."). */
export const toast = (page: Page, title: string): Locator =>
  page.getByRole("status").getByText(title, { exact: true });

/** Chờ mọi toast tự tắt (toast nằm đè lên màn hình nhỏ và chặn thao tác bên dưới). */
export async function waitForToastsGone(page: Page) {
  await expect(page.locator('[aria-live="polite"] [role="status"]')).toHaveCount(0, { timeout: 15_000 });
}

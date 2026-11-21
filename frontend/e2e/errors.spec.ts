import { expect, test } from "@playwright/test";
import { addUrl, cardFor, openHistory, reset, toast } from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto("/");
});

test("link không phải YouTube: báo lỗi ngay, không tạo job", async ({ page }) => {
  await page.getByLabel("Link YouTube").fill("https://example.com/video");
  await page.getByRole("button", { name: /thêm vào hàng đợi/i }).click();
  await expect(page.getByRole("alert")).toContainText("không phải link YouTube");
  await openHistory(page);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("video riêng tư: thẻ lỗi hiện lý do, có thể thử lại/xóa", async ({ page }) => {
  await addUrl(page, "privateVid1");
  await expect(toast(page, "Tải thất bại")).toBeVisible();
  await openHistory(page);
  const card = page.getByRole("article").filter({ hasText: "riêng tư" });
  await expect(card.getByRole("alert")).toContainText("riêng tư");
  await expect(card.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(card.getByRole("button", { name: /cập nhật yt-dlp/i })).toHaveCount(0);
});

test("lỗi cần cập nhật yt-dlp: một chạm để cập nhật và tải lại thành công", async ({ page }) => {
  await addUrl(page, "needsUpdate");
  await expect(toast(page, "Tải thất bại")).toBeVisible();
  await openHistory(page);
  const card = page.getByRole("article").filter({ hasText: "cập nhật yt-dlp" }).first();
  await card.getByRole("button", { name: "Cập nhật yt-dlp và thử lại" }).click();

  await expect(cardFor(page, "needsUpdate").getByRole("button", { name: "Phát" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(toast(page, "Đã cập nhật yt-dlp")).toBeVisible();
});

test("link trùng: hỏi lại, cho tải lại bản mới", async ({ page }) => {
  await addUrl(page, "dQw4w9WgXcQ");
  await expect(toast(page, "Tải xong")).toBeVisible();
  await addUrl(page, "dQw4w9WgXcQ");
  const dialog = page.getByRole("dialog", { name: "Video này đã được tải" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tải lại bản mới" }).click();
  await expect(dialog).toBeHidden();
  await openHistory(page);
  await expect(page.getByRole("article").filter({ hasText: "dQw4w9WgXcQ" })).toHaveCount(2, { timeout: 20_000 });
});

test("link đang trong hàng đợi: báo thay vì tạo trùng", async ({ page }) => {
  await addUrl(page, "slowAAAAAAA");
  await expect(toast(page, "Đã thêm vào hàng đợi")).toBeVisible();
  await addUrl(page, "slowAAAAAAA");
  await expect(toast(page, "Video này đang trong hàng đợi")).toBeVisible();
  await expect(page.getByRole("region", { name: "Hàng đợi" }).getByRole("article")).toHaveCount(1);
});

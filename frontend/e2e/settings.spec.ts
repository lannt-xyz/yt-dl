import { expect, test } from "@playwright/test";
import { reset, toast } from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto("/");
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
});

test("yt-dlp: kiểm tra bản mới → cập nhật → đổi version, có chấm báo trên biểu tượng", async ({ page }) => {
  const version = page.getByTestId("ytdlp-version");
  await expect(version).toContainText("cài sẵn");
  await page.getByRole("button", { name: /Kiểm tra$/ }).click();
  await expect(page.getByText("Có bản mới 9999.01.01")).toBeVisible();
  await page.getByRole("button", { name: /cập nhật$/i }).click();
  await expect(version).toContainText("9999.01.01", { timeout: 20_000 });
  await expect(version).not.toContainText("cài sẵn");
  await expect(toast(page, "Đã cập nhật yt-dlp")).toBeVisible();
});

test("yt-dlp: đổi kênh và bật tự động cập nhật được ghi nhớ sau khi tải lại", async ({ page }) => {
  await page.getByRole("radio", { name: "Nightly" }).click();
  await expect(page.getByRole("radio", { name: "Nightly", checked: true })).toBeVisible();
  await page.getByRole("switch", { name: "Tự động cập nhật" }).click();
  await expect(page.getByRole("switch", { name: "Tự động cập nhật" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("radio", { name: "Nightly", checked: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Tự động cập nhật" })).toHaveAttribute("aria-checked", "true");
  // trả lại mặc định cho các test sau
  await page.getByRole("radio", { name: "Ổn định" }).click();
  await page.getByRole("switch", { name: "Tự động cập nhật" }).click();
});

test("lưu trữ: hiện dung lượng, chính sách và dọn dẹp ngay", async ({ page }) => {
  await expect(page.getByText("Còn trống")).toBeVisible();
  await expect(page.getByText("không bao giờ")).toBeVisible(); // retention = 0 trong E2E
  await page.getByRole("button", { name: /dọn dẹp ngay/i }).click();
  await expect(toast(page, "Không có gì cần dọn")).toBeVisible();
});

test("phím Escape đóng cài đặt", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeHidden();
});

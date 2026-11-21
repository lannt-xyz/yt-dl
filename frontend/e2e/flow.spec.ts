import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { addUrl, cardFor, openHistory, reset, toast } from "./helpers";

const ID = "dQw4w9WgXcQ";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto("/");
});

test("dán link → tải xong → cắt → tải file MP3 về", async ({ page }) => {
  await addUrl(page, ID);
  await expect(toast(page, "Đã thêm vào hàng đợi")).toBeVisible();
  await expect(toast(page, "Tải xong")).toBeVisible();

  await openHistory(page);
  const card = cardFor(page, ID);
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Phát" })).toBeVisible();

  // ---- trim ----
  await card.getByRole("button", { name: "Cắt" }).click();
  const dialog = page.getByRole("dialog", { name: /cắt audio/i });
  await expect(dialog.getByRole("slider", { name: "Điểm bắt đầu" })).toBeVisible();
  for (const [label, value] of [["Bắt đầu", "0:05"], ["Kết thúc", "0:15"]]) {
    const input = dialog.getByLabel(label, { exact: true });
    await input.fill(value);
    await input.press("Enter");
  }
  await expect(dialog.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "5");
  await expect(dialog.getByRole("slider", { name: "Điểm kết thúc" })).toHaveAttribute("aria-valuenow", "15");
  await dialog.getByRole("button", { name: "Cắt và lưu" }).click();
  await expect(toast(page, "Đã lưu bản cắt")).toBeVisible();
  await expect(dialog).toBeHidden();

  // ---- bản cắt xuất hiện trong lịch sử, tải về là MP3 hợp lệ dài ~10s ----
  const trimmed = page.getByRole("article").filter({ has: page.getByLabel("Bản cắt") });
  await expect(trimmed).toBeVisible();
  await expect(trimmed).toContainText("[0:05-0:15]");
  // nút tải: fetch blob rồi lưu không điều hướng khỏi app (Chromium → sự kiện download)
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    trimmed.getByRole("button", { name: "Tải xuống" }).click(),
  ]);
  expect(page.url()).toContain("/");
  const body = fs.readFileSync((await dl.path())!);
  expect(body.subarray(0, 3).toString()).toBe("ID3"); // tag ID3 do ffmpeg ghi
  // 10 giây ở 192 kbps ≈ 240 KB
  expect(body.length).toBeGreaterThan(200_000);
  expect(body.length).toBeLessThan(300_000);
});

test("lịch sử: tìm kiếm, lọc, xóa (cần bấm hai lần)", async ({ page }) => {
  await addUrl(page, ID);
  await expect(toast(page, "Tải xong")).toBeVisible();
  await addUrl(page, "9bZkp7q19f0");
  await openHistory(page);
  await expect(page.getByRole("article")).toHaveCount(2);

  await page.getByLabel("Tìm trong lịch sử").fill(ID);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(cardFor(page, ID)).toBeVisible();
  await page.getByLabel("Tìm trong lịch sử").fill("không-có-gì-khớp");
  await expect(page.getByText("Không có kết quả")).toBeVisible();
  await page.getByRole("button", { name: "Xóa tìm kiếm" }).click();

  await page.getByRole("button", { name: "Lỗi", exact: true }).click();
  await expect(page.getByText("Không có kết quả")).toBeVisible();
  await page.getByRole("button", { name: "Tất cả" }).click();

  const card = cardFor(page, ID);
  await card.getByRole("button", { name: "Xóa" }).click();
  await card.getByRole("button", { name: "Xóa?" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("đóng tab rồi mở lại: lịch sử còn nguyên", async ({ page }) => {
  await addUrl(page, ID);
  await expect(toast(page, "Tải xong")).toBeVisible();
  await page.reload();
  await openHistory(page);
  await expect(cardFor(page, ID)).toBeVisible();
});

test("trình phát: bấm Phát hiện thanh phát và đóng được", async ({ page }) => {
  await addUrl(page, ID);
  await expect(toast(page, "Tải xong")).toBeVisible();
  await openHistory(page);
  await cardFor(page, ID).getByRole("button", { name: "Phát" }).click();
  await expect(page.getByLabel("Tua")).toBeVisible();
  await page.getByRole("button", { name: "Đóng trình phát" }).click();
  await expect(page.getByLabel("Tua")).toBeHidden();
});

import { expect, test } from "@playwright/test";
import { addUrl, cardFor, openDownloadTab, openHistory, reset, toast } from "./helpers";

const IDS = ["slowAAAAAAA", "slowBBBBBBB", "slowCCCCCCC"];

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto("/");
});

test("dán 3 link liên tiếp: chạy tuần tự, báo từng cái, đủ trong lịch sử", async ({ page }) => {
  for (const id of IDS) await addUrl(page, id);

  const queue = page.getByRole("region", { name: "Hàng đợi" });
  await expect(queue.getByRole("article")).toHaveCount(3);
  // tại mọi thời điểm chỉ một job chạy (có thanh tiến trình), các job còn lại "Đang chờ"
  await expect(queue.getByRole("progressbar")).toHaveCount(1);
  await expect(queue.getByText("Đang chờ…")).toHaveCount(2);

  // toast "Tải xong" xuất hiện cho từng URL (chờ đủ 3 lần)
  let toasts = 0;
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        for (const id of IDS) {
          const t = page.getByRole("status").filter({ hasText: `Video thử ${id}` });
          if (!seen.has(id) && (await t.count()) > 0) {
            seen.add(id);
            toasts += 1;
          }
        }
        return toasts;
      },
      { timeout: 45_000, intervals: [100] },
    )
    .toBe(3);

  await expect(queue).toBeHidden();
  await openHistory(page);
  for (const id of IDS) await expect(cardFor(page, id)).toBeVisible();
});

test("huy job đang chạy và job đang chờ", async ({ page }) => {
  await addUrl(page, IDS[0]);
  await addUrl(page, IDS[1]);
  const queue = page.getByRole("region", { name: "Hàng đợi" });
  await expect(queue.getByRole("article")).toHaveCount(2);

  // hủy job đang chờ (cái thứ hai) trước
  await queue.getByRole("article").nth(1).getByRole("button", { name: "Hủy" }).click();
  await expect(queue.getByRole("article")).toHaveCount(1);
  // rồi hủy job đang chạy
  await queue.getByRole("article").first().getByRole("button", { name: "Hủy" }).click();
  await expect(queue).toBeHidden();

  await openHistory(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Thử lại" })).toHaveCount(2);
});

test("badge đếm số mục chưa xem trên điều hướng, hết khi mở lịch sử", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  test.skip(!(await nav.isVisible()), "chỉ có thanh điều hướng dưới trên màn hình hẹp");
  await addUrl(page, "dQw4w9WgXcQ");
  await expect(toast(page, "Tải xong")).toBeVisible();
  const historyBtn = nav.getByRole("button", { name: /Lịch sử/ });
  await expect(historyBtn).toContainText("1");
  await historyBtn.click();
  await expect(historyBtn).not.toContainText("1", { timeout: 8000 });
  await openDownloadTab(page);
});

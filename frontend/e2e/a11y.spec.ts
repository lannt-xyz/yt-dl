import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { AUTH_URL, addUrl, cardFor, openHistory, reset, toast, waitForToastsGone } from "./helpers";

const ID = "dQw4w9WgXcQ";

async function settle(page: Page) {
  // Ảnh thumbnail tải từ mạng và toast nằm đè lên nội dung làm kết quả quét phụ thuộc tốc độ máy
  // Chỉ đợi ảnh đang hiển thị: ảnh loading="lazy" nằm trong vùng bị ẩn sẽ không bao giờ được tải
  await page
    .waitForFunction(
      () => [...document.images].filter((img) => img.getClientRects().length > 0).every((img) => img.complete),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined); // ảnh ngoài (ytimg) chậm/lỗi không được làm hỏng kiểm tra trợ năng
  await waitForToastsGone(page);
}

async function expectNoViolations(page: Page, where: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `Vi phạm trợ năng tại: ${where}`).toEqual([]);
}

test.describe("trợ năng (axe, WCAG 2.1 AA) — sáng và tối", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`các màn hình chính (${scheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await reset(request);
      await page.goto("/");
      await expectNoViolations(page, `${scheme}: trống`);

      await addUrl(page, ID);
      await expect(toast(page, "Tải xong")).toBeVisible();
      await addUrl(page, "privateVid1");
      await expect(toast(page, "Tải thất bại")).toBeVisible();
      await openHistory(page);
      await expect(page.getByRole("article")).toHaveCount(2);
      await expectNoViolations(page, `${scheme}: lịch sử có job xong + lỗi`);

      await cardFor(page, ID).getByRole("button", { name: "Cắt" }).click();
      await expect(page.getByRole("slider", { name: "Điểm bắt đầu" })).toBeVisible();
      await expectNoViolations(page, `${scheme}: trình cắt`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Cài đặt" }).click();
      await expect(page.getByTestId("ytdlp-version")).toBeVisible();
      await expect(page.getByText("Còn trống")).toBeVisible();
      await expectNoViolations(page, `${scheme}: cài đặt`);
    });
  }

  test("màn hình đăng nhập", async ({ page }) => {
    await page.goto(AUTH_URL);
    await expect(page.getByLabel("Mật khẩu")).toBeVisible();
    await expectNoViolations(page, "đăng nhập");
  });
});

test("điều hướng bằng bàn phím: Tab tới nút Cài đặt và mở bằng Enter", async ({ page }) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Cài đặt" });
  await settings.focus();
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeHidden();
});

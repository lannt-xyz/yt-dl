import { expect, test } from "@playwright/test";
import {
  addUrl,
  bottomNavVisible,
  cardFor,
  noHorizontalOverflow,
  openHistory,
  reset,
  toast,
  waitForToastsGone,
} from "./helpers";

const ID = "dQw4w9WgXcQ";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto("/");
  await addUrl(page, ID);
  await expect(toast(page, "Tải xong")).toBeVisible();
  await addUrl(page, "9bZkp7q19f0");
  await expect(toast(page, "Tải xong").first()).toBeVisible();
  await waitForToastsGone(page);
});

test("bố cục đúng theo kích thước màn hình", async ({ page }) => {
  const width = page.viewportSize()!.width;
  if (width >= 1024) {
    // iPad ngang / PC: 2 cột, không có thanh điều hướng dưới, lịch sử luôn hiển thị
    expect(await bottomNavVisible(page)).toBe(false);
    await expect(page.getByLabel("Link YouTube")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lịch sử" })).toBeVisible();
    const form = await page.getByLabel("Link YouTube").boundingBox();
    const history = await page.getByRole("region", { name: "Lịch sử" }).boundingBox();
    expect(history!.x).toBeGreaterThan(form!.x + form!.width - 1); // lịch sử nằm bên phải form
  } else {
    // iPhone / iPad dọc: 1 cột + thanh điều hướng dưới, mỗi lần một tab
    expect(await bottomNavVisible(page)).toBe(true);
    await expect(page.getByRole("region", { name: "Lịch sử" })).toBeHidden();
    await page.getByRole("button", { name: /Lịch sử/ }).click();
    await expect(page.getByRole("region", { name: "Lịch sử" })).toBeVisible();
    await expect(page.getByLabel("Link YouTube")).toBeHidden();
  }
});

test("không tràn ngang ở màn hình chính, lịch sử, cài đặt và trình cắt", async ({ page }) => {
  await noHorizontalOverflow(page);
  await openHistory(page);
  await noHorizontalOverflow(page);

  await cardFor(page, ID).getByRole("button", { name: "Cắt" }).click();
  const trim = page.getByRole("dialog", { name: /cắt audio/i });
  await expect(trim.getByRole("slider", { name: "Điểm bắt đầu" })).toBeVisible();
  await noHorizontalOverflow(page);
  // mọi phần tử của hộp thoại nằm trong khung nhìn theo chiều ngang
  const box = await trim.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("vùng chạm đủ lớn: nút trên thẻ ≥ 44px, tay cầm trim ≥ 44px", async ({ page }) => {
  await openHistory(page);
  const card = cardFor(page, ID);
  for (const name of ["Phát", "Cắt", "Tải xuống", "Xóa"]) {
    const el = card.getByRole("button", { name });
    const b = await el.boundingBox();
    expect(b!.width, `${name} rộng`).toBeGreaterThanOrEqual(43.5);
    expect(b!.height, `${name} cao`).toBeGreaterThanOrEqual(43.5);
  }
  await card.getByRole("button", { name: "Cắt" }).click();
  const trim = page.getByRole("dialog", { name: /cắt audio/i });
  for (const name of ["Điểm bắt đầu", "Điểm kết thúc"]) {
    const b = await trim.getByRole("slider", { name }).boundingBox();
    expect(b!.width, `${name} rộng`).toBeGreaterThanOrEqual(43.5);
  }
  for (const name of ["Bắt đầu +1s", "Bắt đầu −1s", "Kết thúc +1s"]) {
    const b = await trim.getByRole("button", { name }).boundingBox();
    expect(b!.height, name).toBeGreaterThanOrEqual(43.5);
  }
});

test("kéo tay cầm cắt bằng con trỏ cảm ứng/chuột thật, tay cầm cuối ở mép vẫn kéo được", async ({ page }) => {
  await openHistory(page);
  await cardFor(page, ID).getByRole("button", { name: "Cắt" }).click();
  const trim = page.getByRole("dialog", { name: /cắt audio/i });
  const wave = trim.getByTestId("waveform");
  await expect(trim.getByRole("slider", { name: "Điểm bắt đầu" })).toBeVisible();
  const box = (await wave.boundingBox())!;
  const mid = box.y + box.height / 2;

  const end = trim.getByRole("slider", { name: "Điểm kết thúc" });
  const eb = (await trim.locator('[data-grip="end"]').boundingBox())!;
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2); // núm cuối nằm ở đáy sóng âm
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, mid, { steps: 8 });
  await page.mouse.up();
  const endValue = Number(await end.getAttribute("aria-valuenow"));
  expect(endValue).toBeGreaterThan(12);
  expect(endValue).toBeLessThan(18); // ~giữa bài 30s

  const start = trim.getByRole("slider", { name: "Điểm bắt đầu" });
  const sb = (await trim.locator('[data-grip="start"]').boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); // núm đầu nằm ở đỉnh sóng âm
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, mid, { steps: 8 });
  await page.mouse.up();
  const startValue = Number(await start.getAttribute("aria-valuenow"));
  expect(startValue).toBeGreaterThan(4);
  expect(startValue).toBeLessThan(8);
  await expect(trim.getByText("Độ dài đoạn cắt:")).toBeVisible();
});

test("kéo trên sóng âm để chọn chỗ nghe: chỉ di chuyển con trỏ phát, KHÔNG đổi điểm cắt", async ({ page }) => {
  await openHistory(page);
  await cardFor(page, ID).getByRole("button", { name: "Cắt" }).click();
  const trim = page.getByRole("dialog", { name: /cắt audio/i });
  await expect(trim.getByRole("slider", { name: "Điểm bắt đầu" })).toBeVisible();
  const box = (await trim.getByTestId("waveform").boundingBox())!;
  const mid = box.y + box.height / 2;
  const readPos = async () => {
    const m = /(\d+):(\d+(?:\.\d+)?)/.exec((await trim.getByText(/Vị trí phát/).textContent())!)!;
    return Number(m[1]) * 60 + Number(m[2]);
  };

  // đặt đoạn cắt 5s → 25s để hai tay cầm nằm giữa sóng âm
  for (const [label, value] of [["Bắt đầu", "0:05"], ["Kết thúc", "0:25"]]) {
    const input = trim.getByLabel(label, { exact: true });
    await input.fill(value);
    await input.press("Enter");
  }
  const startBefore = await trim.getByRole("slider", { name: "Điểm bắt đầu" }).getAttribute("aria-valuenow");
  const endBefore = await trim.getByRole("slider", { name: "Điểm kết thúc" }).getAttribute("aria-valuenow");

  // kéo ngay SÁT tay cầm đầu (5s ≈ 17% chiều rộng), ở giữa chiều cao → phải là tua, không phải kéo tay cầm
  const startX = box.x + (box.width * 5) / 30;
  await page.mouse.move(startX, mid);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, mid, { steps: 10 });
  await page.mouse.up();

  expect(Math.abs((await readPos()) - 18)).toBeLessThan(0.6); // ~60% của 30s
  expect(await trim.getByRole("slider", { name: "Điểm bắt đầu" }).getAttribute("aria-valuenow")).toBe(startBefore);
  expect(await trim.getByRole("slider", { name: "Điểm kết thúc" }).getAttribute("aria-valuenow")).toBe(endBefore);

  // chạm một chỗ khác: con trỏ nhảy tới đó
  await page.mouse.click(box.x + box.width * 0.1, mid);
  expect(Math.abs((await readPos()) - 3)).toBeLessThan(0.6);
});

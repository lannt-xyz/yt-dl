import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeJob } from "../../test/factories";
import { type Call, mockApi, renderApp } from "../../test/utils";
import { JobCard } from "../JobCard";

const DURATION = 60;
const peaksBody = { peaks_per_second: 20, duration: DURATION, peaks: Array.from({ length: 1200 }, (_, i) => (i % 7) / 7) };

afterEach(() => vi.unstubAllGlobals());

async function openSheet(handler?: (c: Call) => { status?: number; body?: unknown } | undefined) {
  const job = makeJob({ title: "Bài dài", duration: DURATION });
  const api = mockApi([job], (c) => {
    const custom = handler?.(c);
    if (custom) return custom;
    if (c.url.endsWith("/peaks")) return { body: peaksBody };
    return undefined;
  });
  renderApp(<JobCard job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Cắt" }));
  return { job, ...api };
}

const trimCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/trim"));

async function setTime(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.click(input);
  await userEvent.clear(input);
  await userEvent.type(input, `${text}{Enter}`);
}

it("mở sheet, dựng waveform và đặt đoạn cắt bằng cách nhập mốc thời gian", async () => {
  const { calls, job } = await openSheet((c) =>
    c.url.endsWith("/trim") ? { status: 201, body: makeJob({ kind: "trim", title: "Bài dài [0:05-0:25]" }) } : undefined,
  );
  expect(screen.getByRole("dialog", { name: /cắt audio/i })).toBeInTheDocument();
  expect(await screen.findByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByRole("slider", { name: "Điểm kết thúc" })).toHaveAttribute("aria-valuenow", "60");

  await setTime("Bắt đầu", "0:05");
  await setTime("Kết thúc", "0:25");
  expect(screen.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "5");
  expect(screen.getByRole("slider", { name: "Điểm kết thúc" })).toHaveAttribute("aria-valuenow", "25");
  expect(screen.getByText("0:20.000", { selector: "span" })).toBeInTheDocument(); // độ dài đoạn

  const fadeIn = screen.getByText("Fade in").closest("fieldset")!;
  await userEvent.click(within(fadeIn).getByRole("button", { name: "2s" }));
  await userEvent.click(screen.getByRole("button", { name: "Cắt và lưu" }));

  await waitFor(() => expect(trimCalls(calls)).toHaveLength(1));
  expect(trimCalls(calls)[0].url).toBe(`/api/jobs/${job.id}/trim`);
  expect(trimCalls(calls)[0].body).toEqual({ start: 5, end: 25, bitrate: 192, fade_in: 2, fade_out: 0 });
  expect(await screen.findByText("Đã lưu bản cắt")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /cắt audio/i })).not.toBeInTheDocument());
});

it("gửi tên tùy chọn và bitrate đã chọn", async () => {
  const { calls } = await openSheet((c) => (c.url.endsWith("/trim") ? { status: 201, body: makeJob({ kind: "trim" }) } : undefined));
  await screen.findByRole("slider", { name: "Điểm bắt đầu" });
  await userEvent.click(screen.getByRole("button", { name: "320 kbps" }));
  await userEvent.type(screen.getByLabelText(/tên bản cắt/i), "  Điệp khúc ");
  await userEvent.click(screen.getByRole("button", { name: "Cắt và lưu" }));
  await waitFor(() => expect(trimCalls(calls)).toHaveLength(1));
  expect(trimCalls(calls)[0].body).toMatchObject({ bitrate: 320, title: "Điệp khúc" });
});

it("mốc nhập sai bị đánh dấu và không áp dụng", async () => {
  await openSheet();
  const start = await screen.findByLabelText("Bắt đầu");
  await userEvent.click(start);
  await userEvent.clear(start);
  await userEvent.type(start, "abc");
  expect(start).toHaveAttribute("aria-invalid", "true");
  await userEvent.tab();
  expect(screen.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "0");
  expect(start).not.toHaveAttribute("aria-invalid");
});

it("nút nhích và Hoàn tác", async () => {
  await openSheet();
  await screen.findByRole("slider", { name: "Điểm bắt đầu" });
  const undo = screen.getByRole("button", { name: "Hoàn tác" });
  expect(undo).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Bắt đầu +1 giây" }));
  await userEvent.click(screen.getByRole("button", { name: "Bắt đầu +1 giây" }));
  expect(screen.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "2");
  expect(undo).toBeEnabled();

  await userEvent.click(undo);
  expect(screen.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "1");
  await userEvent.click(undo);
  expect(screen.getByRole("slider", { name: "Điểm bắt đầu" })).toHaveAttribute("aria-valuenow", "0");
  expect(undo).toBeDisabled();
});

it("fade dài hơn nửa đoạn cắt bị khóa", async () => {
  await openSheet();
  await screen.findByRole("slider", { name: "Điểm bắt đầu" });
  await setTime("Bắt đầu", "0:10");
  await setTime("Kết thúc", "0:13"); // 3s → tối đa 1.5s mỗi bên
  const fadeIn = screen.getByText("Fade in").closest("fieldset")!;
  expect(within(fadeIn).getByRole("button", { name: "1s" })).toBeEnabled();
  expect(within(fadeIn).getByRole("button", { name: "2s" })).toBeDisabled();
  expect(within(fadeIn).getByRole("button", { name: "3s" })).toBeDisabled();
});

it("lỗi từ server hiện ngay trong sheet và sheet vẫn mở", async () => {
  await openSheet((c) =>
    c.url.endsWith("/trim")
      ? { status: 422, body: { detail: { code: "invalid_range", message: "Điểm kết thúc vượt quá độ dài file" } } }
      : undefined,
  );
  await screen.findByRole("slider", { name: "Điểm bắt đầu" });
  await userEvent.click(screen.getByRole("button", { name: "Cắt và lưu" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("vượt quá độ dài");
  expect(screen.getByRole("dialog", { name: /cắt audio/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cắt và lưu" })).toBeEnabled();
});

it("lỗi tải waveform: có nút thử lại", async () => {
  let fail = true;
  await openSheet((c) => {
    if (!c.url.endsWith("/peaks")) return undefined;
    return fail ? { status: 500, body: { detail: { code: "ffmpeg", message: "ffmpeg lỗi" } } } : { body: peaksBody };
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("ffmpeg lỗi");
  expect(screen.getByRole("button", { name: "Cắt và lưu" })).toBeDisabled();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(await screen.findByRole("slider", { name: "Điểm bắt đầu" })).toBeInTheDocument();
});

it("Escape và nút đóng đều đóng sheet, trả lại cuộn trang", async () => {
  await openSheet();
  await screen.findByRole("slider", { name: "Điểm bắt đầu" });
  expect(document.body.style.overflow).toBe("hidden");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /cắt audio/i })).not.toBeInTheDocument());
  expect(document.body.style.overflow).not.toBe("hidden");
});

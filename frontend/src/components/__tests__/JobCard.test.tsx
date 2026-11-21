import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeJob } from "../../test/factories";
import { FakeEventSource, mockApi, renderApp } from "../../test/utils";
import { JobCard } from "../JobCard";
import { QueueSection } from "../Sections";

afterEach(() => vi.unstubAllGlobals());

it("job đang tải: hiện tiến trình và cho hủy", async () => {
  const job = makeJob({ status: "downloading", progress: 40, title: "Đang tải bài" });
  const { calls } = mockApi([job], (c) =>
    c.url.endsWith("/cancel") ? { body: { ...job, status: "cancelled" } } : undefined,
  );
  renderApp(<JobCard job={job} />);
  const bar = screen.getByRole("progressbar");
  expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(30);
  expect(screen.getByText(/Tải 40%/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Hủy" }));
  await waitFor(() => expect(calls.some((c) => c.url === `/api/jobs/${job.id}/cancel`)).toBe(true));
});

it("job lỗi: hiện lý do và cho thử lại", async () => {
  const job = makeJob({ status: "failed", error_message: "YouTube đã đổi" });
  const { calls } = mockApi([job]);
  renderApp(<JobCard job={job} />);
  expect(screen.getByRole("alert")).toHaveTextContent("YouTube đã đổi");
  await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith("/retry"))).toBe(true));
});

it("job xong: có link tải và nút phát", () => {
  const job = makeJob();
  mockApi([job]);
  renderApp(<JobCard job={job} />);
  expect(screen.getByRole("link", { name: "Tải xuống" })).toHaveAttribute("href", job.download_url);
  expect(screen.getByRole("button", { name: "Phát" })).toBeInTheDocument();
  expect(screen.getByText(/3\.2 MB/)).toBeInTheDocument();
});

it("xóa cần bấm hai lần", async () => {
  const job = makeJob();
  const { calls } = mockApi([job], (c) => (c.method === "DELETE" ? { status: 204 } : undefined));
  renderApp(<JobCard job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Xóa" }));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Xóa?" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
});

it("bản cắt có nhãn, không có nút thử lại khi lỗi", () => {
  const job = makeJob({ kind: "trim", status: "failed" });
  mockApi([job]);
  renderApp(<JobCard job={job} />);
  expect(screen.getByLabelText("Bản cắt")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
});

it("SSE: job chuyển sang xong thì hiện thông báo và biến khỏi hàng đợi", async () => {
  const running = makeJob({ status: "converting", progress: 50, title: "Bài X" });
  mockApi([running]);
  renderApp(<QueueSection />);
  expect(await screen.findByText("Bài X")).toBeInTheDocument();

  FakeEventSource.latest().emit("job", { type: "job", job: { ...running, status: "done", progress: 100 } });

  const toast = await screen.findByRole("status");
  expect(within(toast).getByText("Tải xong")).toBeInTheDocument();
  // toast vẫn nhắc tên bài, nhưng thẻ trong hàng đợi phải biến mất
  await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
});

it("SSE: sự kiện deleted gỡ job khỏi danh sách", async () => {
  const job = makeJob({ status: "queued", title: "Sắp bị xóa" });
  mockApi([job]);
  renderApp(<QueueSection />);
  expect(await screen.findByText("Sắp bị xóa")).toBeInTheDocument();
  FakeEventSource.latest().emit("deleted", { type: "deleted", id: job.id });
  await waitFor(() => expect(screen.queryByText("Sắp bị xóa")).not.toBeInTheDocument());
});

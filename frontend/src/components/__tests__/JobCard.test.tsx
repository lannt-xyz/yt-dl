import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeJob } from "../../test/factories";
import { FakeEventSource, mockApi, renderApp } from "../../test/utils";
import { JobCard } from "../JobCard";
import { useJobs } from "../../state/jobs";
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


it("job xong nhanh: SSE 'done' tới trước response POST thì không bị ghi đè về 'queued'", async () => {
  const queued = makeJob({ status: "queued", title: "Job nhanh" });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => (release = r));
  mockApi([], (c) => (c.method === "POST" ? { status: 201, body: queued } : undefined));
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") await gate;
    return real(input, init);
  });

  function Probe() {
    const { submit, jobs } = useJobs();
    return (
      <div>
        <button type="button" onClick={() => void submit("https://youtu.be/dQw4w9WgXcQ")}>
          gửi
        </button>
        <p data-testid="status">{jobs.map((j) => j.status).join(",")}</p>
      </div>
    );
  }
  renderApp(<Probe />);
  await userEvent.click(screen.getByRole("button", { name: "gửi" }));
  FakeEventSource.latest().emit("job", { type: "job", job: { ...queued, status: "done", progress: 100 } });
  await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
  release?.();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByTestId("status")).toHaveTextContent("done");
});


it("job lỗi nhanh: SSE báo lỗi tới trước phản hồi tạo job vẫn hiện thông báo, và không bị ghi đè về 'queued'", async () => {
  const queued = makeJob({ status: "queued", title: "Job lỗi nhanh" });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => (release = r));
  mockApi([], (c) => (c.method === "POST" ? { status: 201, body: queued } : undefined));
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") await gate;
    return real(input, init);
  });

  function Probe() {
    const { submit, jobs } = useJobs();
    return (
      <div>
        <button type="button" onClick={() => void submit("https://youtu.be/dQw4w9WgXcQ")}>
          gửi
        </button>
        <p data-testid="status">{jobs.map((j) => j.status).join(",")}</p>
      </div>
    );
  }
  renderApp(<Probe />);
  await userEvent.click(screen.getByRole("button", { name: "gửi" }));
  // job chưa hề có trong danh sách của trình duyệt, SSE đã báo nó lỗi
  FakeEventSource.latest().emit("job", {
    type: "job",
    job: { ...queued, status: "failed", error_message: "Video riêng tư" },
  });
  expect(await screen.findByText("Tải thất bại")).toBeInTheDocument();
  release?.(); // giờ phản hồi cũ (queued) mới về
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByTestId("status")).toHaveTextContent("failed");
  expect(screen.getAllByText("Tải thất bại")).toHaveLength(1);
});


it("hai sự kiện SSE dồn trong cùng một nhịp (đã vào hàng đợi → lỗi): vẫn hiện thông báo lỗi", async () => {
  // Máy chậm/mạng chậm khiến SSE gửi nhiều sự kiện cùng lúc: ở sự kiện thứ hai React chưa kịp render lại.
  const queued = makeJob({ status: "queued", title: "Job dồn sự kiện" });
  mockApi([]);
  function Probe() {
    const { jobs } = useJobs();
    return <p data-testid="status">{jobs.map((j) => j.status).join(",")}</p>;
  }
  renderApp(<Probe />);
  await screen.findByTestId("status");
  const source = FakeEventSource.latest();
  act(() => {
    source.emit("job", { type: "job", job: queued });
    source.emit("job", { type: "job", job: { ...queued, status: "failed", error_message: "riêng tư" } });
  });
  expect(await screen.findByText("Tải thất bại")).toBeInTheDocument();
  expect(screen.getByTestId("status")).toHaveTextContent("failed");
});

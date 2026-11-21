import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { YtdlpStatus } from "../../api/client";
import { makeJob } from "../../test/factories";
import { type Call, FakeEventSource, mockApi, renderApp } from "../../test/utils";
import { JobCard } from "../JobCard";
import { SettingsSheet } from "../SettingsSheet";

afterEach(() => vi.unstubAllGlobals());

const status = (over: Partial<YtdlpStatus> = {}): YtdlpStatus => ({
  version: "2026.10.26",
  source: "bundled",
  channel: "stable",
  auto_update: false,
  latest: "2026.11.01",
  update_available: true,
  last_check: 1_700_000_000,
  last_error: null,
  versions: [],
  previous: null,
  updating: false,
  ...over,
});

function ytdlpApi(state: { current: YtdlpStatus }, extra?: (c: Call) => { status?: number; body?: unknown } | undefined) {
  return mockApi([], (c) => {
    const custom = extra?.(c);
    if (custom) return custom;
    if (c.url === "/api/ytdlp") return { body: state.current };
    return undefined;
  });
}

it("hiện version đang dùng, bản mới nhất và thông báo có bản mới", async () => {
  ytdlpApi({ current: status() });
  renderApp(<SettingsSheet onClose={() => {}} />);
  expect(await screen.findByTestId("ytdlp-version")).toHaveTextContent("2026.10.26");
  expect(screen.getByTestId("ytdlp-version")).toHaveTextContent("cài sẵn");
  expect(screen.getByText("Có bản mới 2026.11.01")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /cập nhật$/i })).toBeEnabled();
});

it("hết bản mới thì nút Cập nhật bị khóa", async () => {
  ytdlpApi({ current: status({ update_available: false, latest: "2026.10.26" }) });
  renderApp(<SettingsSheet onClose={() => {}} />);
  await screen.findByTestId("ytdlp-version");
  expect(screen.getByRole("button", { name: /cập nhật$/i })).toBeDisabled();
});

it("bấm Cập nhật gửi yêu cầu, rồi SSE báo hoàn tất thì hiện version mới và toast", async () => {
  const state = { current: status() };
  const { calls } = ytdlpApi(state, (c) => (c.url === "/api/ytdlp/update" ? { status: 202, body: { accepted: true } } : undefined));
  renderApp(<SettingsSheet onClose={() => {}} />);
  await screen.findByTestId("ytdlp-version");
  await userEvent.click(screen.getByRole("button", { name: /cập nhật$/i }));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/ytdlp/update" && c.method === "POST")).toBe(true));
  expect(await screen.findByText("Đang cập nhật…")).toBeInTheDocument();

  FakeEventSource.latest().emit("ytdlp", {
    type: "ytdlp",
    status: status({ version: "2026.11.01", source: "venv", update_available: false, previous: "2026.10.26" }),
  });
  await waitFor(() => expect(screen.getByTestId("ytdlp-version")).toHaveTextContent("2026.11.01"));
  expect(screen.getByRole("button", { name: /Quay lại 2026\.10\.26/ })).toBeInTheDocument();
  expect(await screen.findByText("Đã cập nhật yt-dlp")).toBeInTheDocument();
});

it("cập nhật thất bại: toast lỗi, version giữ nguyên", async () => {
  ytdlpApi({ current: status() });
  renderApp(<SettingsSheet onClose={() => {}} />);
  await screen.findByTestId("ytdlp-version");
  FakeEventSource.latest().emit("ytdlp", { type: "ytdlp", status: status(), error: "Bản 2026.11.01 không qua kiểm tra" });
  expect(await screen.findByText("Cập nhật yt-dlp thất bại")).toBeInTheDocument();
  expect(screen.getByText(/không qua kiểm tra/)).toBeInTheDocument();
  expect(screen.getByTestId("ytdlp-version")).toHaveTextContent("2026.10.26");
});

it("quay lại bản trước", async () => {
  const state = { current: status({ source: "venv", version: "2026.11.01", previous: "2026.10.26" }) };
  const { calls } = ytdlpApi(state, (c) =>
    c.url === "/api/ytdlp/rollback" ? { body: status({ version: "2026.10.26", source: "venv", previous: "2026.11.01" }) } : undefined,
  );
  renderApp(<SettingsSheet onClose={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /Quay lại 2026\.10\.26/ }));
  await waitFor(() => expect(screen.getByTestId("ytdlp-version")).toHaveTextContent("2026.10.26"));
  expect(calls.some((c) => c.url === "/api/ytdlp/rollback")).toBe(true);
});

it("đổi kênh và bật tự động cập nhật được gửi lên server", async () => {
  const { calls } = ytdlpApi({ current: status() }, (c) =>
    c.url === "/api/ytdlp/settings"
      ? { body: status({ channel: "nightly", auto_update: (c.body as { auto_update?: boolean }).auto_update === true }) }
      : undefined,
  );
  renderApp(<SettingsSheet onClose={() => {}} />);
  await userEvent.click(await screen.findByRole("radio", { name: "Nightly" }));
  await waitFor(() => expect(calls.find((c) => c.url === "/api/ytdlp/settings")?.body).toEqual({ channel: "nightly" }));
  await userEvent.click(screen.getByRole("switch", { name: "Tự động cập nhật" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "/api/ytdlp/settings").at(-1)?.body).toEqual({ auto_update: true }));
  expect(await screen.findByRole("radio", { name: "Nightly", checked: true })).toBeInTheDocument();
});

it("hiện lỗi kiểm tra gần nhất", async () => {
  ytdlpApi({ current: status({ last_error: "Không kiểm tra được bản mới: mất mạng" }) });
  renderApp(<SettingsSheet onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("mất mạng");
});

it("Escape đóng cài đặt", async () => {
  ytdlpApi({ current: status() });
  const onClose = vi.fn();
  renderApp(<SettingsSheet onClose={onClose} />);
  await screen.findByTestId("ytdlp-version");
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

describe("job lỗi needs_update", () => {
  const failed = () => makeJob({ status: "failed", error_code: "needs_update", error_message: "YouTube đã đổi" });

  it("có nút cập nhật yt-dlp và thử lại: check → update → retry", async () => {
    const job = failed();
    const { calls } = mockApi([job], (c) => {
      if (c.url === "/api/ytdlp") return { body: status() };
      if (c.url === "/api/ytdlp/check") return { body: status() };
      if (c.url === "/api/ytdlp/update") return { status: 202, body: { accepted: true } };
      if (c.url.endsWith("/retry")) return { body: { ...job, status: "queued" } };
      return undefined;
    });
    renderApp(<JobCard job={job} />);
    await userEvent.click(screen.getByRole("button", { name: "Cập nhật yt-dlp và thử lại" }));
    await waitFor(() => expect(calls.some((c) => c.url === `/api/jobs/${job.id}/retry`)).toBe(true));
    const order = calls.map((c) => c.url).filter((u) => u.startsWith("/api/ytdlp/") || u.endsWith("/retry"));
    expect(order.indexOf("/api/ytdlp/update")).toBeLessThan(order.findIndex((u) => u.endsWith("/retry")));
  });

  it("lỗi khác không hiện nút cập nhật", () => {
    const job = makeJob({ status: "failed", error_code: "private", error_message: "riêng tư" });
    mockApi([job]);
    renderApp(<JobCard job={job} />);
    expect(screen.queryByRole("button", { name: /cập nhật yt-dlp/i })).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("riêng tư")).toBeInTheDocument();
  });
});

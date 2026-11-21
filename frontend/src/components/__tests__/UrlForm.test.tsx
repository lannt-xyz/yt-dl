import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeJob } from "../../test/factories";
import { type Call, mockApi, renderApp } from "../../test/utils";
import { UrlForm } from "../UrlForm";

const VALID = "https://youtu.be/dQw4w9WgXcQ";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

it("từ chối link không phải YouTube, không gọi API", async () => {
  const { calls } = mockApi();
  renderApp(<UrlForm />);
  await userEvent.type(screen.getByLabelText("Link YouTube"), "https://example.com/video");
  await userEvent.click(screen.getByRole("button", { name: /thêm vào hàng đợi/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("không phải link YouTube");
  expect(posts(calls)).toHaveLength(0);
});

it("gửi link hợp lệ kèm bitrate đã chọn, xóa ô nhập và báo đã thêm", async () => {
  const job = makeJob({ status: "queued" });
  const { calls } = mockApi([], (c) => (c.method === "POST" ? { status: 201, body: job } : undefined));
  renderApp(<UrlForm />);
  await userEvent.click(screen.getByRole("radio", { name: "320k" }));
  await userEvent.type(screen.getByLabelText("Link YouTube"), VALID);
  await userEvent.click(screen.getByRole("button", { name: /thêm vào hàng đợi/i }));

  await waitFor(() => expect(posts(calls)).toHaveLength(1));
  expect(posts(calls)[0].body).toEqual({ url: VALID, bitrate: 320, force: false });
  expect(await screen.findByText("Đã thêm vào hàng đợi")).toBeInTheDocument();
  expect(screen.getByLabelText("Link YouTube")).toHaveValue("");
  expect(localStorage.getItem("yt-mp3:bitrate")).toBe("320");
});

it("tách link ra khỏi câu chia sẻ", async () => {
  const { calls } = mockApi([], (c) => (c.method === "POST" ? { status: 201, body: makeJob() } : undefined));
  renderApp(<UrlForm />);
  await userEvent.type(screen.getByLabelText("Link YouTube"), `Nghe đi ${VALID} hay lắm`);
  await userEvent.click(screen.getByRole("button", { name: /thêm vào hàng đợi/i }));
  await waitFor(() => expect(posts(calls)[0].body).toMatchObject({ url: VALID }));
});

it("hiện lỗi từ máy chủ", async () => {
  mockApi([], (c) =>
    c.method === "POST"
      ? { status: 422, body: { detail: { code: "invalid_url", message: "Không tìm thấy video trong URL" } } }
      : undefined,
  );
  renderApp(<UrlForm />);
  await userEvent.type(screen.getByLabelText("Link YouTube"), VALID);
  await userEvent.click(screen.getByRole("button", { name: /thêm vào hàng đợi/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tìm thấy video");
});

it("link trùng: hỏi lại và tải với force=true khi xác nhận", async () => {
  const existing = makeJob({ title: "Bản cũ" });
  let n = 0;
  const { calls } = mockApi([], (c) => {
    if (c.method !== "POST") return undefined;
    n += 1;
    return n === 1
      ? { status: 409, body: { detail: { code: "duplicate", message: "đã tải", job: existing } } }
      : { status: 201, body: makeJob({ status: "queued" }) };
  });
  renderApp(<UrlForm />);
  await userEvent.type(screen.getByLabelText("Link YouTube"), VALID);
  await userEvent.click(screen.getByRole("button", { name: /thêm vào hàng đợi/i }));

  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Bản cũ");
  await userEvent.click(screen.getByRole("button", { name: "Tải lại bản mới" }));
  await waitFor(() => expect(posts(calls)).toHaveLength(2));
  expect(posts(calls)[1].body).toMatchObject({ force: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("deep-link ?url= tự gửi rồi xóa tham số khỏi địa chỉ", async () => {
  window.history.replaceState(null, "", `/?url=${encodeURIComponent(VALID)}`);
  const { calls } = mockApi([], (c) => (c.method === "POST" ? { status: 201, body: makeJob() } : undefined));
  renderApp(<UrlForm />);
  await waitFor(() => expect(posts(calls)).toHaveLength(1));
  expect(posts(calls)[0].body).toMatchObject({ url: VALID });
  expect(window.location.search).toBe("");
});

it("nút dán đọc clipboard và tự gửi khi là link YouTube", async () => {
  const { calls } = mockApi([], (c) => (c.method === "POST" ? { status: 201, body: makeJob() } : undefined));
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: vi.fn().mockResolvedValue(VALID) },
    configurable: true,
  });
  renderApp(<UrlForm />);
  await userEvent.click(screen.getByRole("button", { name: "Dán từ clipboard" }));
  await waitFor(() => expect(posts(calls)).toHaveLength(1));
});

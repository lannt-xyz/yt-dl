import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeJob } from "../../test/factories";
import { mockApi, renderApp } from "../../test/utils";
import App from "../../App";
import { UrlForm } from "../UrlForm";

const sw = vi.hoisted(() => ({ needRefresh: false, setNeedRefresh: vi.fn(), update: vi.fn() }));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, sw.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.update,
  }),
}));

import { PwaUpdater } from "../PwaUpdater";

beforeEach(() => {
  sw.needRefresh = false;
  sw.setNeedRefresh.mockClear();
  sw.update.mockClear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("PwaUpdater", () => {
  it("không hiện gì khi không có bản mới", () => {
    render(<PwaUpdater />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("có bản mới: banner với nút Tải lại và Để sau", async () => {
    sw.needRefresh = true;
    render(<PwaUpdater />);
    expect(screen.getByRole("alert")).toHaveTextContent("Có phiên bản mới");
    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(sw.update).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Để sau" }));
    expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
  });
});

describe("điều hướng PWA", () => {
  it("?tab=history (shortcut) mở thẳng tab Lịch sử", async () => {
    window.history.replaceState(null, "", "/?tab=history");
    mockApi([makeJob()]);
    renderApp(<App />);
    expect(await screen.findByRole("button", { name: /Lịch sử/, current: "page" })).toBeInTheDocument();
  });

  it("mặc định mở tab Tải về", async () => {
    mockApi([]);
    renderApp(<App />);
    expect(await screen.findByRole("button", { name: /Tải về/, current: "page" })).toBeInTheDocument();
  });

  it("bấm vào thông báo khi app đang mở: service worker gửi message → chuyển tab Lịch sử", async () => {
    let listener: ((e: MessageEvent) => void) | undefined;
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        addEventListener: (_: string, fn: (e: MessageEvent) => void) => (listener = fn),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
    mockApi([]);
    renderApp(<App />);
    await screen.findByRole("button", { name: /Tải về/, current: "page" });
    act(() => listener?.({ data: { type: "navigate", url: "/?tab=history&job=abc" } } as MessageEvent));
    await waitFor(() => expect(screen.getByRole("button", { name: /Lịch sử/, current: "page" })).toBeInTheDocument());
    act(() => listener?.({ data: { type: "khác" } } as MessageEvent));
    expect(screen.getByRole("button", { name: /Lịch sử/, current: "page" })).toBeInTheDocument();
  });
});

describe("offline", () => {
  it("mất mạng: báo rõ và khóa nút thêm link; có mạng lại thì mở khóa", async () => {
    mockApi([]);
    renderApp(<UrlForm />);
    await userEvent.type(screen.getByLabelText("Link YouTube"), "https://youtu.be/dQw4w9WgXcQ");
    const button = screen.getByRole("button", { name: /thêm vào hàng đợi/i });
    expect(button).toBeEnabled();

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/Không có kết nối mạng/)).toBeInTheDocument();
    expect(button).toBeDisabled();

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText(/Không có kết nối mạng/)).not.toBeInTheDocument();
  });
});

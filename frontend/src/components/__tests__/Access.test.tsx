import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext, AuthProvider } from "../../state/auth";
import { ToastProvider } from "../../state/toast";
import { makeJob } from "../../test/factories";
import { type Call, mockApi, renderApp } from "../../test/utils";
import { AccessSection } from "../AccessSection";
import { JobCard } from "../JobCard";
import { StorageSection } from "../StorageSection";

afterEach(() => vi.unstubAllGlobals());

type Resp = { status?: number; body?: unknown } | undefined;

function setup(handler: (c: Call) => Resp) {
  return mockApi([], handler);
}

function renderAuth(ui = <div>NỘI DUNG APP</div>) {
  return render(
    <ToastProvider>
      <AuthProvider>{ui}</AuthProvider>
    </ToastProvider>,
  );
}

describe("AuthProvider / màn hình đăng nhập", () => {
  it("server không yêu cầu mật khẩu: vào thẳng app", async () => {
    setup((c) => (c.url === "/api/auth/status" ? { body: { required: false, authenticated: true } } : undefined));
    renderAuth();
    expect(await screen.findByText("NỘI DUNG APP")).toBeInTheDocument();
  });

  it("chưa đăng nhập: hiện form, nội dung app CHƯA được dựng", async () => {
    setup((c) => (c.url === "/api/auth/status" ? { body: { required: true, authenticated: false } } : undefined));
    renderAuth();
    expect(await screen.findByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.queryByText("NỘI DUNG APP")).not.toBeInTheDocument();
  });

  it("đăng nhập đúng: gửi mật khẩu rồi vào app", async () => {
    const { calls } = setup((c) => {
      if (c.url === "/api/auth/status") return { body: { required: true, authenticated: false } };
      if (c.url === "/api/auth/login") return { body: { authenticated: true } };
      return undefined;
    });
    renderAuth();
    await userEvent.type(await screen.findByLabelText("Mật khẩu"), "bí mật{Enter}");
    expect(await screen.findByText("NỘI DUNG APP")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/auth/login")?.body).toEqual({ password: "bí mật" });
  });

  it("sai mật khẩu: hiện lỗi, xóa ô nhập, vẫn ở màn hình đăng nhập", async () => {
    setup((c) => {
      if (c.url === "/api/auth/status") return { body: { required: true, authenticated: false } };
      if (c.url === "/api/auth/login")
        return { status: 401, body: { detail: { code: "bad_password", message: "Sai mật khẩu" } } };
      return undefined;
    });
    renderAuth();
    const input = await screen.findByLabelText("Mật khẩu");
    await userEvent.type(input, "sai{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sai mật khẩu");
    expect(input).toHaveValue("");
    expect(screen.queryByText("NỘI DUNG APP")).not.toBeInTheDocument();
  });

  it("bị khóa do thử sai nhiều lần: hiện thông điệp từ server", async () => {
    setup((c) => {
      if (c.url === "/api/auth/status") return { body: { required: true, authenticated: false } };
      if (c.url === "/api/auth/login")
        return { status: 429, body: { detail: { code: "rate_limited", message: "Chờ 120 giây rồi thử lại." } } };
      return undefined;
    });
    renderAuth();
    await userEvent.type(await screen.findByLabelText("Mật khẩu"), "x{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Chờ 120 giây");
  });

  it("nút đăng nhập bị khóa khi chưa nhập gì", async () => {
    setup((c) => (c.url === "/api/auth/status" ? { body: { required: true, authenticated: false } } : undefined));
    renderAuth();
    await screen.findByLabelText("Mật khẩu");
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeDisabled();
  });

  it("mất kết nối tới server: báo lỗi và cho thử lại", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new TypeError("network");
        return new Response(JSON.stringify({ required: false, authenticated: true }));
      }),
    );
    renderAuth();
    expect(await screen.findByText("Không kết nối được tới máy chủ")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("NỘI DUNG APP")).toBeInTheDocument();
  });

  it("phiên hết hạn giữa chừng (401) → quay về màn hình đăng nhập", async () => {
    setup((c) => {
      if (c.url === "/api/auth/status") return { body: { required: true, authenticated: true } };
      if (c.url.startsWith("/api/jobs")) return { status: 401, body: { detail: { code: "unauthorized", message: "Cần đăng nhập" } } };
      return undefined;
    });
    const { api } = await import("../../api/client");
    renderAuth();
    expect(await screen.findByText("NỘI DUNG APP")).toBeInTheDocument();
    await api.listJobs().catch(() => undefined);
    expect(await screen.findByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.queryByText("NỘI DUNG APP")).not.toBeInTheDocument();
  });
});

describe("AccessSection", () => {
  const withAuth = (required: boolean, logout = vi.fn(async () => {})) =>
    renderApp(
      <AuthContext.Provider value={{ required, logout }}>
        <AccessSection />
      </AuthContext.Provider>,
    );

  it("ẩn hoàn toàn khi server không bật đăng nhập", () => {
    setup(() => undefined);
    withAuth(false);
    expect(screen.queryByText("Truy cập")).not.toBeInTheDocument();
  });

  it("tạo token: hiện đúng một lần, rồi chỉ còn trong danh sách (không kèm giá trị)", async () => {
    let items = [] as unknown[];
    const { calls } = setup((c) => {
      if (c.url === "/api/auth/tokens" && c.method === "GET") return { body: { items } };
      if (c.url === "/api/auth/tokens" && c.method === "POST") {
        items = [{ id: "t1", name: "iPhone", created_at: 1_700_000_000, last_used_at: null }];
        return { status: 201, body: { id: "t1", name: "iPhone", token: "ytm_SECRET123" } };
      }
      return undefined;
    });
    withAuth(true);
    await userEvent.type(await screen.findByLabelText("Tên token"), "iPhone");
    await userEvent.click(screen.getByRole("button", { name: /^Tạo$/ }));
    expect(await screen.findByTestId("new-token")).toHaveTextContent("ytm_SECRET123");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "iPhone" });
    expect(await screen.findByText("Chưa dùng")).toBeInTheDocument();
    expect(screen.getAllByText(/ytm_SECRET123/)).toHaveLength(1);
  });

  it("thu hồi token", async () => {
    let items = [{ id: "t1", name: "Máy cũ", created_at: 1_700_000_000, last_used_at: 1_700_000_100 }];
    const { calls } = setup((c) => {
      if (c.url === "/api/auth/tokens" && c.method === "GET") return { body: { items } };
      if (c.url === "/api/auth/tokens/t1" && c.method === "DELETE") {
        items = [];
        return { status: 204 };
      }
      return undefined;
    });
    withAuth(true);
    await userEvent.click(await screen.findByRole("button", { name: "Thu hồi Máy cũ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByText("Máy cũ")).not.toBeInTheDocument());
  });

  it("đăng xuất", async () => {
    setup((c) => (c.url === "/api/auth/tokens" ? { body: { items: [] } } : undefined));
    const logout = vi.fn(async () => {});
    withAuth(true, logout);
    await userEvent.click(await screen.findByRole("button", { name: /đăng xuất/i }));
    expect(logout).toHaveBeenCalled();
  });

  it("có hướng dẫn tạo Phím tắt với địa chỉ của server", async () => {
    setup((c) => (c.url === "/api/auth/tokens" ? { body: { items: [] } } : undefined));
    withAuth(true);
    await screen.findByText("Cách tạo Phím tắt trên iPhone/iPad");
    expect(screen.getByText(`${window.location.origin}/api/jobs`)).toBeInTheDocument();
  });
});

describe("StorageSection", () => {
  const info = (over = {}) => ({
    ytdlp_version: "1",
    disk: { total: 100 * 1024 ** 3, used: 40 * 1024 ** 3, free: 60 * 1024 ** 3 },
    audio_bytes: 5 * 1024 ** 2,
    storage: { retention_days: 30, max_storage_gb: 0, files: 3 },
    backups: { count: 2, latest_age_seconds: 100 },
    auth_enabled: false,
    ...over,
  });

  it("hiện dung lượng, chính sách lưu trữ và số bản sao lưu", async () => {
    setup((c) => (c.url === "/api/system" ? { body: info() } : undefined));
    renderApp(<StorageSection />);
    expect(await screen.findByText("60.0 GB")).toBeInTheDocument();
    expect(screen.getByText("30 ngày")).toBeInTheDocument();
    expect(screen.getByText("không giới hạn")).toBeInTheDocument();
    expect(screen.getByText("2 bản")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cảnh báo khi ổ đĩa sắp đầy", async () => {
    setup((c) =>
      c.url === "/api/system"
        ? { body: info({ disk: { total: 100 * 1024 ** 3, used: 99 * 1024 ** 3, free: 1024 ** 3 } }) }
        : undefined,
    );
    renderApp(<StorageSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("sắp đầy");
  });

  it("dọn dẹp ngay: gọi API và báo kết quả", async () => {
    const { calls } = setup((c) => {
      if (c.url === "/api/system") return { body: info() };
      if (c.url === "/api/system/cleanup")
        return { body: { removed_files: 2, orphan_files: 1, freed_bytes: 3 * 1024 ** 2 } };
      return undefined;
    });
    renderApp(<StorageSection />);
    await userEvent.click(await screen.findByRole("button", { name: /dọn dẹp ngay/i }));
    expect(await screen.findByText("Đã dọn dẹp")).toBeInTheDocument();
    expect(screen.getByText(/3 file, giải phóng 3\.0 MB/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/system/cleanup")).toHaveLength(1);
  });

  it("không có gì để dọn", async () => {
    setup((c) => {
      if (c.url === "/api/system") return { body: info() };
      if (c.url === "/api/system/cleanup") return { body: { removed_files: 0, orphan_files: 0, freed_bytes: 0 } };
      return undefined;
    });
    renderApp(<StorageSection />);
    await userEvent.click(await screen.findByRole("button", { name: /dọn dẹp ngay/i }));
    expect(await screen.findByText("Không có gì cần dọn")).toBeInTheDocument();
  });
});

describe("thẻ job đã bị dọn file", () => {
  it("báo đã dọn, ẩn phát/cắt/tải, cho Tải lại", async () => {
    const job = makeJob({ status: "done", has_file: false, audio_url: null, download_url: null });
    const { calls } = mockApi([job]);
    renderApp(<JobCard job={job} />);
    expect(screen.getByText(/Đã dọn file/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Phát" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cắt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tải xuống" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(calls.some((c) => c.url === `/api/jobs/${job.id}/retry`)).toBe(true));
  });

  it("bản cắt đã dọn file không có nút Tải lại", () => {
    const job = makeJob({ kind: "trim", status: "done", has_file: false });
    mockApi([job]);
    renderApp(<JobCard job={job} />);
    expect(screen.queryByRole("button", { name: "Tải lại" })).not.toBeInTheDocument();
  });
});

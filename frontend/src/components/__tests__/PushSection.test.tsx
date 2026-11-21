import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Call, mockApi, renderApp } from "../../test/utils";
import { PushSection } from "../PushSection";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const KEY = "BPkeyAAA"; // 8 ký tự → base64 hợp lệ

interface Env {
  ios?: boolean;
  standalone?: boolean;
  permission?: NotificationPermission;
  subscribed?: boolean;
  requestResult?: NotificationPermission;
  noPush?: boolean;
}

function setupEnv(env: Env = {}) {
  const sub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "pk", auth: "ak" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  let current: typeof sub | null = env.subscribed ? sub : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (_opts: unknown) => {
      current = sub;
      return sub;
    }),
  };
  const reg = { pushManager };
  vi.stubGlobal("Notification", {
    permission: env.permission ?? "default",
    requestPermission: vi.fn(async () => env.requestResult ?? "granted"),
  });
  if (!env.noPush) vi.stubGlobal("PushManager", class {});
  else vi.stubGlobal("PushManager", undefined);
  Object.defineProperty(window, "PushManager", { value: env.noPush ? undefined : class {}, configurable: true });
  if (env.noPush) delete (window as { PushManager?: unknown }).PushManager;
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve(reg), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(navigator, "userAgent", {
    value: env.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (X11; Linux) Chrome/130",
    configurable: true,
  });
  Object.defineProperty(navigator, "standalone", { value: env.standalone ?? false, configurable: true });
  return { sub, pushManager };
}

function api(handler?: (c: Call) => { status?: number; body?: unknown } | undefined) {
  return mockApi([], (c) => {
    const custom = handler?.(c);
    if (custom) return custom;
    if (c.url === "/api/push/key") return { body: { public_key: KEY } };
    if (c.url === "/api/push/status") return { body: { subscribed: true, devices: 1 } };
    if (c.url === "/api/push/subscribe") return { status: 201, body: { subscribed: true } };
    if (c.url === "/api/push/unsubscribe") return { body: { removed: true } };
    if (c.url === "/api/push/test") return { body: { sent: 1 } };
    return undefined;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "standalone");
});

it("iOS chưa cài ra Màn hình chính: hướng dẫn cài, không có công tắc", async () => {
  setupEnv({ ios: true, standalone: false });
  api();
  renderApp(<PushSection />);
  expect(await screen.findByText("Cần thêm app vào Màn hình chính")).toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});

it("trình duyệt không hỗ trợ push: báo rõ", async () => {
  setupEnv({ noPush: true });
  api();
  renderApp(<PushSection />);
  expect(await screen.findByText(/không hỗ trợ thông báo đẩy/)).toBeInTheDocument();
});

it("quyền bị chặn: hướng dẫn bật lại", async () => {
  setupEnv({ permission: "denied" });
  api();
  renderApp(<PushSection />);
  expect(await screen.findByRole("alert")).toHaveTextContent("đang bị chặn");
});

it("bật thông báo: xin quyền → lấy khóa VAPID → subscribe → báo server", async () => {
  const { pushManager } = setupEnv();
  const { calls } = api();
  renderApp(<PushSection />);
  const toggle = await screen.findByRole("switch", { name: "Thông báo trên thiết bị này" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await userEvent.click(toggle);

  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
  const opts = pushManager.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
  expect(opts.userVisibleOnly).toBe(true);
  expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
  const sent = calls.find((c) => c.url === "/api/push/subscribe");
  expect(sent?.body).toEqual({ endpoint: ENDPOINT, keys: { p256dh: "pk", auth: "ak" } });
  expect(screen.getByRole("button", { name: /gửi thông báo thử/i })).toBeInTheDocument();
});

it("người dùng từ chối quyền: không subscribe, chuyển sang trạng thái bị chặn", async () => {
  const { pushManager } = setupEnv({ requestResult: "denied" });
  const { calls } = api();
  renderApp(<PushSection />);
  await userEvent.click(await screen.findByRole("switch"));
  expect(await screen.findByRole("alert")).toHaveTextContent("đang bị chặn");
  expect(pushManager.subscribe).not.toHaveBeenCalled();
  expect(calls.some((c) => c.url === "/api/push/subscribe")).toBe(false);
});

it("đã có subscription: hiện bật; server quên thì tự đăng ký lại", async () => {
  setupEnv({ subscribed: true, permission: "granted" });
  const { calls } = api((c) => (c.url === "/api/push/status" ? { body: { subscribed: false, devices: 0 } } : undefined));
  renderApp(<PushSection />);
  const toggle = await screen.findByRole("switch");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/push/subscribe")).toBe(true));
});

it("tắt thông báo: hủy subscription ở trình duyệt và server", async () => {
  const { sub } = setupEnv({ subscribed: true, permission: "granted" });
  const { calls } = api();
  renderApp(<PushSection />);
  const toggle = await screen.findByRole("switch");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(sub.unsubscribe).toHaveBeenCalled();
  expect(calls.find((c) => c.url === "/api/push/unsubscribe")?.body).toEqual({ endpoint: ENDPOINT });
});

it("gửi thông báo thử", async () => {
  setupEnv({ subscribed: true, permission: "granted" });
  const { calls } = api();
  renderApp(<PushSection />);
  await userEvent.click(await screen.findByRole("button", { name: /gửi thông báo thử/i }));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/push/test")).toBe(true));
});

it("lỗi server khi đăng ký hiện thông báo lỗi và công tắc vẫn tắt", async () => {
  setupEnv();
  api((c) =>
    c.url === "/api/push/subscribe"
      ? { status: 422, body: { detail: { code: "invalid_subscription", message: "Endpoint push không hợp lệ" } } }
      : undefined,
  );
  renderApp(<PushSection />);
  const toggle = await screen.findByRole("switch");
  await userEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent("không hợp lệ");
  expect(toggle).toHaveAttribute("aria-checked", "false");
});

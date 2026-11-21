export type PushSupport = "ok" | "needs-install" | "unsupported";

export function isIos(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ tự nhận là Mac nhưng có màn hình cảm ứng
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function isStandalone(win: {
  matchMedia?: (q: string) => { matches: boolean };
  navigator: { standalone?: boolean };
}): boolean {
  return (
    win.navigator.standalone === true ||
    (typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches)
  );
}

export interface SupportInput {
  ios: boolean;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

/** iOS/iPadOS chỉ cho Web Push khi app đã "Thêm vào Màn hình chính". */
export function detectSupport(i: SupportInput): PushSupport {
  if (i.ios && !i.standalone) return "needs-install";
  if (!i.hasServiceWorker || !i.hasPushManager || !i.hasNotification) return "unsupported";
  return "ok";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function currentSupport(): PushSupport {
  return detectSupport({
    ios: isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    standalone: isStandalone(window as never),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}

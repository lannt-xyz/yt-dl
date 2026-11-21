import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { type PushSupport, currentSupport, urlBase64ToUint8Array } from "../lib/push";

export type PushState = "loading" | PushSupport | "denied" | "off" | "on";

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const support = currentSupport();
    if (support !== "ok") return setState(support);
    if (Notification.permission === "denied") return setState("denied");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return setState("off");
      // đảm bảo server vẫn nhớ subscription này (vd. đã bị xóa do hết hạn)
      const known = await api.push.status(sub.endpoint).catch(() => null);
      if (known && !known.subscribed) await api.push.subscribe(sub.toJSON());
      setState("on");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (fn: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Phải gọi từ thao tác chạm của người dùng (yêu cầu của iOS/Safari). */
  const enable = useCallback(
    () =>
      run(async () => {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const { public_key } = await api.push.key();
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key),
          }));
        await api.push.subscribe(sub.toJSON());
        setState("on");
      }, "Không bật được thông báo"),
    [run],
  );

  const disable = useCallback(
    () =>
      run(async () => {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.push.unsubscribe(sub.endpoint).catch(() => undefined);
          await sub.unsubscribe();
        }
        setState("off");
      }, "Không tắt được thông báo"),
    [run],
  );

  const sendTest = useCallback(
    () =>
      run(async () => {
        await api.push.test();
      }, "Không gửi được thông báo thử"),
    [run],
  );

  return { state, busy, error, enable, disable, sendTest };
}

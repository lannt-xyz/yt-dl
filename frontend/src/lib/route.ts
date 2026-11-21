import type { Tab } from "../components/BottomNav";

/** `?tab=history` (từ shortcut của PWA / bấm vào thông báo) → tab tương ứng. */
export function tabFromSearch(search: string): Tab {
  return new URLSearchParams(search).get("tab") === "history" ? "history" : "download";
}

/** Lấy phần query từ đường dẫn tương đối mà service worker gửi sang ("/?tab=history&job=x"). */
export function searchOf(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? "" : url.slice(i);
}

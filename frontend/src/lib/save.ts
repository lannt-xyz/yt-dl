/**
 * Lưu file MP3 mà KHÔNG điều hướng khỏi app.
 * `<a download>` trong PWA standalone của iOS sẽ chuyển cả webview sang file,
 * không có nút quay lại. Thay vào đó: tải blob rồi mở share sheet (Lưu vào Tệp),
 * nếu không có thì dùng blob URL + thẻ a tạm.
 */
export async function saveAudio(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: "audio/mpeg" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // người dùng đóng sheet
      // NotAllowedError (hết user-gesture) → rơi xuống cách dự phòng
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

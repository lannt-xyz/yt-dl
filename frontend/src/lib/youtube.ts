const YT_HOST = /^(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)$/i;

/** Kiểm tra nhanh phía client (server vẫn là nơi xác thực chính thức). */
export function looksLikeYoutubeUrl(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return YT_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Lấy link YouTube đầu tiên trong đoạn văn bản (vd. khi dán cả câu chia sẻ). */
export function extractYoutubeUrl(text: string): string | null {
  for (const token of text.split(/\s+/)) {
    if (looksLikeYoutubeUrl(token)) return token;
  }
  return null;
}

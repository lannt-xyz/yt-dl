import { extractYoutubeUrl, looksLikeYoutubeUrl } from "../youtube";

describe("looksLikeYoutubeUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "  https://youtu.be/dQw4w9WgXcQ  ",
  ])("chấp nhận %s", (url) => expect(looksLikeYoutubeUrl(url)).toBe(true));

  it.each([
    "",
    "   ",
    "hello world",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=x",
    "https://notyoutube.com/x",
  ])("từ chối %j", (url) => expect(looksLikeYoutubeUrl(url)).toBe(false));
});

describe("extractYoutubeUrl", () => {
  it("lấy link trong câu chia sẻ", () => {
    expect(extractYoutubeUrl("Nghe bài này nè https://youtu.be/dQw4w9WgXcQ hay lắm")).toBe(
      "https://youtu.be/dQw4w9WgXcQ",
    );
  });
  it("trả null khi không có link", () => {
    expect(extractYoutubeUrl("không có link")).toBeNull();
  });
});

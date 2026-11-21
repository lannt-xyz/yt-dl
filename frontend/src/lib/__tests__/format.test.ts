import { formatBytes, formatDuration, relativeTime } from "../format";

describe("formatBytes", () => {
  it.each([
    [null, "—"],
    [-1, "—"],
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [3_400_000, "3.2 MB"],
    [250 * 1024 * 1024, "250 MB"],
    [5 * 1024 ** 3, "5.0 GB"],
  ])("%s → %s", (input, expected) => {
    expect(formatBytes(input as number | null)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [null, "—"],
    [Number.NaN, "—"],
    [0, "0:00"],
    [5, "0:05"],
    [83, "1:23"],
    [3723, "1:02:03"],
    [59.6, "1:00"],
  ])("%s → %s", (input, expected) => {
    expect(formatDuration(input as number | null)).toBe(expected);
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000;
  it.each([
    [now - 10, "vừa xong"],
    [now - 120, "2 phút trước"],
    [now - 7200, "2 giờ trước"],
    [now - 86400 * 3, "3 ngày trước"],
  ])("%s", (ts, expected) => {
    expect(relativeTime(ts, now)).toBe(expected);
  });

  it("dùng ngày tháng khi quá một tuần", () => {
    expect(relativeTime(now - 86400 * 30, now)).toMatch(/\d/);
  });

  it("không âm khi đồng hồ lệch", () => {
    expect(relativeTime(now + 500, now)).toBe("vừa xong");
  });
});

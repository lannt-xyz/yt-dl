import {
  FADE_OPTIONS,
  MIN_LENGTH,
  clampRange,
  formatTimeMs,
  fractionToTime,
  maxFade,
  nudge,
  parseTimeInput,
  peaksForView,
  setEnd,
  setStart,
  timeToFraction,
  viewFor,
} from "../trim";

describe("parseTimeInput", () => {
  it.each([
    ["90", 90],
    ["90.5", 90.5],
    ["90,5", 90.5],
    ["1:30", 90],
    ["1:23.450", 83.45],
    ["01:02:03", 3723],
    ["1m30s", 90],
    ["2m", 120],
    ["45s", 45],
    ["  0:05 ", 5],
    ["0", 0],
  ])("%s → %s", (text, expected) => expect(parseTimeInput(text)).toBeCloseTo(expected, 6));

  it.each(["", "  ", "abc", "-5", "1:2:3:4", "1.5:30", "1:x", "m", "1::2"])(
    "từ chối %j",
    (text) => expect(parseTimeInput(text)).toBeNull(),
  );
});

describe("formatTimeMs", () => {
  it.each([
    [0, "0:00.000"],
    [83.45, "1:23.450"],
    [59.9996, "1:00.000"],
    [3723.5, "1:02:03.500"],
    [-4, "0:00.000"],
  ])("%s → %s", (s, expected) => expect(formatTimeMs(s)).toBe(expected));

  it("parse ∘ format là phép nghịch đảo (tới ms)", () => {
    for (const s of [0, 0.123, 12.5, 83.45, 600, 3723.5]) {
      expect(parseTimeInput(formatTimeMs(s))).toBeCloseTo(s, 3);
    }
  });
});

describe("range", () => {
  const D = 100;
  it("clampRange giữ trong [0,duration] và tối thiểu MIN_LENGTH", () => {
    expect(clampRange({ start: -5, end: 200 }, D)).toEqual({ start: 0, end: 100 });
    const r = clampRange({ start: 50, end: 50 }, D);
    expect(r.end - r.start).toBeGreaterThanOrEqual(MIN_LENGTH - 1e-9);
    expect(clampRange({ start: 90, end: 10 }, D).start).toBeLessThan(10);
  });

  it("setStart không vượt qua end", () => {
    expect(setStart({ start: 10, end: 20 }, 25, D)).toEqual({ start: 20 - MIN_LENGTH, end: 20 });
    expect(setStart({ start: 10, end: 20 }, -3, D).start).toBe(0);
  });

  it("setEnd không vượt qua start và không quá duration", () => {
    expect(setEnd({ start: 10, end: 20 }, 5, D)).toEqual({ start: 10, end: 10 + MIN_LENGTH });
    expect(setEnd({ start: 10, end: 20 }, 500, D).end).toBe(100);
  });

  it("nudge hai phía", () => {
    expect(nudge({ start: 10, end: 20 }, "start", 1, D)).toEqual({ start: 11, end: 20 });
    expect(nudge({ start: 10, end: 20 }, "end", -0.5, D)).toEqual({ start: 10, end: 19.5 });
    expect(nudge({ start: 0, end: 20 }, "start", -1, D).start).toBe(0);
    expect(nudge({ start: 10, end: 100 }, "end", 5, D).end).toBe(100);
  });

  it("bài ngắn hơn MIN_LENGTH không gây NaN", () => {
    const r = clampRange({ start: 0, end: 1 }, 0.05);
    expect(Number.isFinite(r.start) && Number.isFinite(r.end)).toBe(true);
  });

  it("maxFade = nửa độ dài", () => {
    expect(maxFade({ start: 10, end: 16 })).toBe(3);
    expect(FADE_OPTIONS[0]).toBe(0);
  });
});

describe("view", () => {
  it("toàn bài khi không zoom", () => {
    expect(viewFor({ start: 10, end: 20 }, 100, false)).toEqual({ from: 0, to: 100 });
  });
  it("zoom quanh đoạn chọn, bị chặn ở biên", () => {
    expect(viewFor({ start: 10, end: 20 }, 100, true)).toEqual({ from: 8, to: 22 });
    expect(viewFor({ start: 0, end: 5 }, 100, true).from).toBe(0);
    expect(viewFor({ start: 95, end: 100 }, 100, true).to).toBe(100);
  });
  it("đổi qua lại thời gian ↔ tỉ lệ", () => {
    const v = { from: 20, to: 60 };
    expect(timeToFraction(40, v)).toBe(0.5);
    expect(fractionToTime(0.25, v)).toBe(30);
    expect(fractionToTime(timeToFraction(33.3, v), v)).toBeCloseTo(33.3);
  });
});

describe("peaksForView", () => {
  const peaks = [0.1, 0.9, 0.2, 0.3, 0.8, 0.1, 0.4, 0.5]; // pps = 1 → 8 giây
  it("lấy max mỗi cột", () => {
    expect(peaksForView(peaks, 1, { from: 0, to: 8 }, 4)).toEqual([0.9, 0.3, 0.8, 0.5]);
  });
  it("chỉ lấy phần trong view", () => {
    expect(peaksForView(peaks, 1, { from: 4, to: 8 }, 2)).toEqual([0.8, 0.5]);
  });
  it("nhiều cột hơn dữ liệu vẫn có giá trị, không rỗng", () => {
    const out = peaksForView(peaks, 1, { from: 0, to: 8 }, 16);
    expect(out).toHaveLength(16);
    expect(Math.max(...out)).toBe(0.9);
  });
  it("trường hợp rỗng", () => {
    expect(peaksForView([], 1, { from: 0, to: 8 }, 4)).toEqual([]);
    expect(peaksForView(peaks, 1, { from: 0, to: 8 }, 0)).toEqual([]);
  });
});

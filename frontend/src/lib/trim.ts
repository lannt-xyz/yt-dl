export const MIN_LENGTH = 0.1; // giây, khớp với server

export interface Range {
  start: number;
  end: number;
}

export interface View {
  from: number;
  to: number;
}

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** "1:23.45", "83.4", "1m23s", "1:02:03" → giây; null nếu không hợp lệ. */
export function parseTimeInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":");
    if (parts.length > 3) return null;
    const nums = parts.map((p) => (/^\d+(\.\d+)?$/.test(p) ? Number(p) : Number.NaN));
    if (nums.some(Number.isNaN)) return null;
    if (nums.slice(0, -1).some((n) => !Number.isInteger(n))) return null;
    return nums.reduce((acc, n) => acc * 60 + n, 0);
  }
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** 83.45 → "1:23.450"; 3723.5 → "1:02:03.500". */
export function formatTimeMs(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const whole = Math.floor(totalMs / 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const msStr = String(ms).padStart(3, "0");
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}.${msStr}` : `${m}:${pad2(s)}.${msStr}`;
}

export function clampRange(r: Range, duration: number, minLen = MIN_LENGTH): Range {
  const end = clamp(r.end, Math.min(minLen, duration), duration);
  const start = clamp(r.start, 0, Math.max(0, end - minLen));
  return { start, end };
}

export function setStart(r: Range, value: number, duration: number): Range {
  return clampRange({ start: value, end: r.end }, duration);
}

export function setEnd(r: Range, value: number, duration: number): Range {
  return clampRange({ start: r.start, end: Math.max(value, r.start + MIN_LENGTH) }, duration);
}

export function nudge(r: Range, which: "start" | "end", delta: number, duration: number): Range {
  return which === "start"
    ? setStart(r, r.start + delta, duration)
    : setEnd(r, r.end + delta, duration);
}

/** Khoảng thời gian đang hiển thị: toàn bài, hoặc phóng to quanh đoạn chọn. */
export function viewFor(r: Range, duration: number, zoomed: boolean): View {
  if (!zoomed) return { from: 0, to: duration };
  const pad = Math.max((r.end - r.start) * 0.2, 1);
  const from = Math.max(0, r.start - pad);
  const to = Math.min(duration, r.end + pad);
  return to - from < MIN_LENGTH ? { from: 0, to: duration } : { from, to };
}

export const timeToFraction = (t: number, v: View) => (t - v.from) / (v.to - v.from);
export const fractionToTime = (f: number, v: View) => v.from + f * (v.to - v.from);

/** Rút gọn peaks thành `buckets` cột (lấy giá trị lớn nhất mỗi cột) trong khoảng `view`. */
export function peaksForView(peaks: number[], pps: number, view: View, buckets: number): number[] {
  if (buckets <= 0 || peaks.length === 0) return [];
  const out = new Array<number>(buckets).fill(0);
  const span = view.to - view.from;
  for (let b = 0; b < buckets; b++) {
    const t0 = view.from + (b / buckets) * span;
    const t1 = view.from + ((b + 1) / buckets) * span;
    const i0 = Math.max(0, Math.floor(t0 * pps));
    const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(t1 * pps)));
    let max = 0;
    for (let i = i0; i < i1; i++) if (peaks[i] > max) max = peaks[i];
    out[b] = max;
  }
  return out;
}

/** Fade tối đa mỗi bên sao cho tổng không vượt quá độ dài đoạn cắt. */
export function maxFade(r: Range): number {
  return Math.max(0, (r.end - r.start) / 2);
}

export const FADE_OPTIONS = [0, 0.5, 1, 2, 3] as const;

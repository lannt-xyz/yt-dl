import { makeJob } from "../../test/factories";
import {
  activeJobs,
  displayTitle,
  jobsReducer,
  matchesQuery,
  overallProgress,
  sortJobs,
  stepIndex,
  transitionNotice,
} from "../jobs";

describe("overallProgress / stepIndex", () => {
  it("tăng đơn điệu qua các bước", () => {
    const values = [
      overallProgress({ status: "queued", progress: 0 }),
      overallProgress({ status: "fetching_info", progress: 0 }),
      overallProgress({ status: "downloading", progress: 0 }),
      overallProgress({ status: "downloading", progress: 100 }),
      overallProgress({ status: "converting", progress: 0 }),
      overallProgress({ status: "done", progress: 100 }),
    ];
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(100);
  });
  it("stepIndex", () => {
    expect(stepIndex("queued")).toBe(-1);
    expect(stepIndex("fetching_info")).toBe(0);
    expect(stepIndex("converting")).toBe(2);
  });
});

describe("transitionNotice", () => {
  const running = makeJob({ status: "downloading" });
  it("báo khi tải xong", () => {
    const n = transitionNotice(running, { ...running, status: "done" });
    expect(n).toMatchObject({ tone: "success", title: "Tải xong", text: "Bài hát thử" });
  });
  it("báo lỗi kèm lý do", () => {
    const n = transitionNotice(running, { ...running, status: "failed", error_message: "HTTP 403" });
    expect(n?.tone).toBe("error");
    expect(n?.text).toContain("HTTP 403");
  });
  it("không báo khi hủy, khi vẫn đang chạy, hoặc là bản cắt", () => {
    expect(transitionNotice(running, { ...running, status: "cancelled" })).toBeNull();
    expect(transitionNotice(running, { ...running, status: "converting" })).toBeNull();
    const trim = makeJob({ kind: "trim", status: "converting" });
    expect(transitionNotice(trim, { ...trim, status: "done" })).toBeNull();
    expect(transitionNotice(undefined, { ...trim, status: "done" })).toBeNull();
  });
  it("job chưa biết mà sự kiện cho thấy đã xong/lỗi (xong quá nhanh hoặc do thiết bị khác thêm) vẫn phải báo", () => {
    expect(transitionNotice(undefined, { ...running, status: "done" })).toMatchObject({ tone: "success" });
    expect(
      transitionNotice(undefined, { ...running, status: "failed", error_message: "riêng tư" }),
    ).toMatchObject({ tone: "error", title: "Tải thất bại" });
  });
  it("job chưa biết nhưng còn đang chờ/chạy (vd. phản hồi tạo job) thì chưa báo; đã hủy cũng không báo", () => {
    expect(transitionNotice(undefined, { ...running, status: "queued" })).toBeNull();
    expect(transitionNotice(undefined, { ...running, status: "downloading" })).toBeNull();
    expect(transitionNotice(undefined, { ...running, status: "cancelled" })).toBeNull();
  });
  it("không báo lại khi job đã xong từ trước", () => {
    const done = makeJob({ status: "done" });
    expect(transitionNotice(done, done)).toBeNull();
  });
});

describe("jobsReducer", () => {
  it("replace / upsert / remove", () => {
    const a = makeJob();
    const b = makeJob();
    let s = jobsReducer({}, { type: "replace", jobs: [a, b] });
    expect(Object.keys(s)).toHaveLength(2);
    s = jobsReducer(s, { type: "upsert", job: { ...a, title: "Mới" } });
    expect(s[a.id].title).toBe("Mới");
    s = jobsReducer(s, { type: "remove", id: a.id });
    expect(Object.keys(s)).toEqual([b.id]);
    expect(jobsReducer(s, { type: "remove", id: "nope" })).toBe(s);
  });
});

describe("sắp xếp & lọc", () => {
  it("sortJobs: mới nhất trước", () => {
    const a = makeJob({ created_at: 1 });
    const b = makeJob({ created_at: 3 });
    const c = makeJob({ created_at: 2 });
    expect(sortJobs([a, b, c]).map((j) => j.id)).toEqual([b.id, c.id, a.id]);
  });
  it("activeJobs: đang chạy trước, hàng chờ theo thứ tự cũ → mới", () => {
    const q1 = makeJob({ status: "queued", created_at: 1 });
    const q2 = makeJob({ status: "queued", created_at: 2 });
    const run = makeJob({ status: "downloading", created_at: 0 });
    const done = makeJob({ status: "done" });
    expect(activeJobs([q2, done, q1, run]).map((j) => j.id)).toEqual([run.id, q1.id, q2.id]);
  });
  it("matchesQuery không phân biệt hoa thường, tìm cả kênh", () => {
    const j = makeJob({ title: "Đêm Nay", channel: "Sơn Tùng" });
    expect(matchesQuery(j, "")).toBe(true);
    expect(matchesQuery(j, "đêm")).toBe(true);
    expect(matchesQuery(j, "SƠN")).toBe(true);
    expect(matchesQuery(j, "xyz")).toBe(false);
  });
  it("displayTitle có fallback", () => {
    expect(displayTitle(makeJob({ title: null, video_id: "abcdefghijk" }))).toBe("youtu.be/abcdefghijk");
  });
});

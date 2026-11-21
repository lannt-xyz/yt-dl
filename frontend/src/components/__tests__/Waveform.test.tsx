import { fireEvent, render, screen } from "@testing-library/react";
import { Waveform } from "../Waveform";

const peaks = Array.from({ length: 200 }, (_, i) => (i % 10) / 10);

function setup(over: Partial<React.ComponentProps<typeof Waveform>> = {}) {
  const onChange = vi.fn();
  const onSeek = vi.fn();
  render(
    <Waveform
      peaks={peaks}
      peaksPerSecond={2}
      duration={100}
      range={{ start: 20, end: 60 }}
      view={{ from: 0, to: 100 }}
      playhead={30}
      onChange={onChange}
      onSeek={onSeek}
      {...over}
    />,
  );
  const box = screen.getByTestId("waveform");
  // jsdom không có layout: giả lập hộp rộng 1000px bắt đầu từ x=0
  box.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 144, right: 1000, bottom: 144, x: 0, y: 0, toJSON: () => ({}) });
  return { onChange, onSeek, box };
}

const grip = (name: string) =>
  screen.getByRole("slider", { name }).querySelector("[data-grip]") as HTMLElement;

it("có hai tay cầm dạng slider với giá trị đúng", () => {
  setup();
  const start = screen.getByRole("slider", { name: "Điểm bắt đầu" });
  const end = screen.getByRole("slider", { name: "Điểm kết thúc" });
  expect(start).toHaveAttribute("aria-valuenow", "20");
  expect(start).toHaveAttribute("aria-valuetext", "0:20.000");
  expect(end).toHaveAttribute("aria-valuenow", "60");
  expect(end).toHaveAttribute("aria-valuemax", "100");
});

it("kéo tay cầm đầu: onChange liên tục (commit=false), thả tay thì commit=true", () => {
  const { onChange } = setup();
  const start = grip("Điểm bắt đầu");
  fireEvent.pointerDown(start, { pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(start, { pointerId: 1, clientX: 250 });
  expect(onChange).toHaveBeenLastCalledWith({ start: 25, end: 60 }, false);
  fireEvent.pointerUp(start, { pointerId: 1, clientX: 300 });
  expect(onChange).toHaveBeenLastCalledWith({ start: 30, end: 60 }, true);
});

it("tay cầm cuối không vượt qua tay cầm đầu", () => {
  const { onChange } = setup();
  const end = grip("Điểm kết thúc");
  fireEvent.pointerDown(end, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 50 });
  const [range] = onChange.mock.calls.at(-1)!;
  expect(range.start).toBe(20);
  expect(range.end).toBeCloseTo(20.1, 5);
});

it("kéo vượt biên thì bị chặn trong [0, duration]", () => {
  const { onChange } = setup();
  const end = grip("Điểm kết thúc");
  fireEvent.pointerDown(end, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 5000 });
  expect(onChange.mock.calls.at(-1)![0].end).toBe(100);
});

it("bàn phím: mũi tên nhích 0.1s, Shift nhích 1s", () => {
  const { onChange } = setup();
  const start = screen.getByRole("slider", { name: "Điểm bắt đầu" });
  fireEvent.keyDown(start, { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith({ start: 20.1, end: 60 }, true);
  fireEvent.keyDown(start, { key: "ArrowLeft", shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith({ start: 19, end: 60 }, true);
  const calls = onChange.mock.calls.length;
  fireEvent.keyDown(start, { key: "a" });
  expect(onChange.mock.calls.length).toBe(calls);
});

it("chạm vào nền sóng âm: nhảy tới vị trí đó; chạm núm tay cầm thì KHÔNG tua", () => {
  const { onSeek, onChange, box } = setup();
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 400 });
  fireEvent.pointerUp(box, { pointerId: 1, clientX: 400 });
  expect(onSeek).toHaveBeenCalledWith(40);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(grip("Điểm bắt đầu"), { pointerId: 2, clientX: 200 });
  expect(onSeek).toHaveBeenCalledTimes(1);
});

it("kéo trên nền sóng âm = tua liên tục (không đụng tới điểm cắt), thả tay thì dừng", () => {
  const { onSeek, onChange, box } = setup();
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 300 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 5000 }); // vượt biên → kẹp ở cuối bài
  expect(onSeek.mock.calls.map((c) => c[0])).toEqual([10, 30, 100]);
  fireEvent.pointerUp(box, { pointerId: 1, clientX: 5000 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 400 });
  expect(onSeek).toHaveBeenCalledTimes(3);
  expect(onChange).not.toHaveBeenCalled();
});

it("kéo từ ngay sát tay cầm (giữa chiều cao) vẫn là tua, không kéo tay cầm", () => {
  const { onSeek, onChange, box } = setup();
  // tay cầm đầu đang ở 20s (x=200): bấm đúng vị trí đó trên nền
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 450 });
  expect(onSeek).toHaveBeenLastCalledWith(45);
  expect(onChange).not.toHaveBeenCalled();
});

it("kéo núm tay cầm thì chỉ đổi điểm cắt, không tua", () => {
  const { onSeek, onChange } = setup();
  const end = grip("Điểm kết thúc");
  fireEvent.pointerDown(end, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 700 });
  fireEvent.pointerUp(end, { pointerId: 1, clientX: 700 });
  expect(onChange).toHaveBeenCalled();
  expect(onSeek).not.toHaveBeenCalled();
});

it("chỉ phần núm của tay cầm nhận con trỏ; thân tay cầm xuyên qua để tua", () => {
  setup();
  const slider = screen.getByRole("slider", { name: "Điểm bắt đầu" });
  expect(slider.className).toContain("pointer-events-none");
  expect(slider.querySelector("[data-grip]")!.className).toContain("pointer-events-auto");
});

it("zoom: vị trí tay cầm và phép quy đổi thời gian theo view", () => {
  const { onChange } = setup({ view: { from: 10, to: 70 } });
  const start = screen.getByRole("slider", { name: "Điểm bắt đầu" });
  expect(start.style.left).toMatch(/^16\.6/); // (20-10)/60
  const startGrip = grip("Điểm bắt đầu");
  fireEvent.pointerDown(startGrip, { pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(startGrip, { pointerId: 1, clientX: 500 }); // giữa view = 40s
  expect(onChange.mock.calls.at(-1)![0].start).toBe(40);
});

it("ẩn playhead khi nằm ngoài view", () => {
  setup({ playhead: 5, view: { from: 10, to: 70 } });
  expect(screen.queryByTestId("playhead")).not.toBeInTheDocument();
});

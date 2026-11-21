import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Job } from "../api/types";

interface PlayerApi {
  current: Job | null;
  playing: boolean;
  time: number;
  duration: number;
  toggle: (job: Job) => void;
  pause: () => void;
  seek: (seconds: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

/** Một thẻ <audio> dùng chung; play() luôn được gọi từ thao tác chạm (yêu cầu của iOS). */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Job | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const sync = () => {
      setTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("loadedmetadata", sync);
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  const toggle = useCallback((job: Job) => {
    const audio = audioRef.current;
    if (!audio || !job.audio_url) return;
    if (audio.dataset.jobId === job.id) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    audio.dataset.jobId = job.id;
    audio.src = job.audio_url;
    setCurrent(job);
    setTime(0);
    setDuration(job.duration ?? 0);
    void audio.play();
  }, []);

  const value = useMemo<PlayerApi>(
    () => ({
      current,
      playing,
      time,
      duration,
      toggle,
      pause: () => audioRef.current?.pause(),
      seek: (s) => {
        if (audioRef.current) audioRef.current.currentTime = s;
      },
      close: () => {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          delete audio.dataset.jobId;
        }
        setCurrent(null);
      },
    }),
    [current, playing, time, duration, toggle],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer phải nằm trong PlayerProvider");
  return ctx;
}

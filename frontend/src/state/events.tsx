import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Handler = (data: unknown) => void;

interface EventsApi {
  online: boolean;
  /** type: tên sự kiện SSE ("job", "deleted", "ytdlp") hoặc "open" khi (kết nối lại) thành công. */
  subscribe: (type: string, handler: Handler) => () => void;
}

const EventsContext = createContext<EventsApi | null>(null);
const SERVER_EVENTS = ["job", "deleted", "ytdlp", "hello"];

/** Một kết nối SSE duy nhất cho toàn app; các provider khác đăng ký lắng nghe qua `subscribe`. */
export function EventsProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const handlers = useRef(new Map<string, Set<Handler>>());

  const api = useMemo<EventsApi>(
    () => ({
      online,
      subscribe: (type, handler) => {
        const set = handlers.current.get(type) ?? new Set();
        set.add(handler);
        handlers.current.set(type, set);
        return () => {
          set.delete(handler);
        };
      },
    }),
    [online],
  );

  useEffect(() => {
    const dispatch = (type: string, data: unknown) => {
      for (const h of handlers.current.get(type) ?? []) h(data);
    };
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setOnline(true);
      dispatch("open", null);
    };
    source.onerror = () => setOnline(false);
    for (const type of SERVER_EVENTS) {
      source.addEventListener(type, (e) => {
        try {
          dispatch(type, JSON.parse((e as MessageEvent<string>).data));
        } catch {
          /* bỏ qua gói tin hỏng */
        }
      });
    }
    return () => source.close();
  }, []);

  return <EventsContext.Provider value={api}>{children}</EventsContext.Provider>;
}

export function useEvents(): EventsApi {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useEvents phải nằm trong EventsProvider");
  return ctx;
}

/** Đăng ký lắng nghe một loại sự kiện trong suốt vòng đời component. */
export function useEvent(type: string, handler: Handler) {
  const { subscribe } = useEvents();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(type, (d) => ref.current(d)), [subscribe, type]);
}

import { AudioLines, Loader2, Lock } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, api, setUnauthorizedHandler } from "../api/client";

type Phase = "loading" | "login" | "ready" | "error";

export interface AuthApi {
  /** Server có yêu cầu đăng nhập không (false = chế độ mở). */
  required: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthApi | null>(null);

/**
 * Cổng đăng nhập nằm NGOÀI cùng: khi chưa đăng nhập, các provider bên trong (SSE, danh sách job…)
 * chưa được dựng nên không bắn request 401 liên tục.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [required, setRequired] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const s = await api.auth.status();
      setRequired(s.required);
      setPhase(s.authenticated ? "ready" : "login");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setUnauthorizedHandler(() => setPhase((p) => (p === "ready" ? "login" : p)));
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      required,
      logout: async () => {
        await api.auth.logout().catch(() => undefined);
        setPhase("login");
      },
    }),
    [required],
  );

  if (phase === "loading") {
    return (
      <div role="status" aria-label="Đang tải" className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="font-semibold">Không kết nối được tới máy chủ</p>
          <p className="mt-1 text-sm text-muted">Kiểm tra mạng hoặc máy chủ rồi thử lại.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 h-12 rounded-xl bg-accent px-6 font-semibold text-accent-ink"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }
  if (phase === "login") return <LoginScreen onSuccess={() => setPhase("ready")} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đăng nhập được");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-sm"
      >
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-ink">
            <AudioLines className="size-8" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">YT → MP3</h1>
          <p className="text-sm text-muted">Nhập mật khẩu để tiếp tục</p>
        </div>
        <label htmlFor="pw" className="text-sm font-semibold">
          Mật khẩu
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 focus-within:border-accent">
          <Lock className="size-5 shrink-0 text-muted" />
          <input
            id="pw"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pw-error" : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>
        {error && (
          <p id="pw-error" role="alert" className="mt-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy && <Loader2 className="size-5 animate-spin" />}
          Đăng nhập
        </button>
      </form>
    </main>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong AuthProvider");
  return ctx;
}

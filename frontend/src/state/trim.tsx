import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Job } from "../api/types";
import { TrimSheet } from "../components/TrimSheet";

interface TrimApi {
  open: (job: Job) => void;
}

const TrimContext = createContext<TrimApi | null>(null);

export function TrimProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const close = useCallback(() => setJob(null), []);
  const api = useMemo(() => ({ open: setJob }), []);
  return (
    <TrimContext.Provider value={api}>
      {children}
      {job && <TrimSheet key={job.id} job={job} onClose={close} />}
    </TrimContext.Provider>
  );
}

export function useTrim(): TrimApi {
  const ctx = useContext(TrimContext);
  if (!ctx) throw new Error("useTrim phải nằm trong TrimProvider");
  return ctx;
}

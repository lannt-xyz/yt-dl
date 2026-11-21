import clsx from "clsx";
import { AudioLines, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useMediaQuery } from "./lib/useMediaQuery";
import { BottomNav, type Tab } from "./components/BottomNav";
import { MiniPlayer } from "./components/MiniPlayer";
import { HistorySection, QueueSection, RecentSection } from "./components/Sections";
import { UrlForm } from "./components/UrlForm";
import { isActive } from "./api/types";
import { useJobs } from "./state/jobs";

export default function App() {
  const { jobs, unseen, online } = useJobs();
  const [tab, setTab] = useState<Tab>("download");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const activeCount = jobs.filter((j) => isActive(j.status)).length;

  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) YT → MP3` : "YT → MP3";
  }, [unseen]);

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-16">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 lg:max-w-6xl">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
              <AudioLines className="size-5" />
            </span>
            <h1 className="text-lg font-bold tracking-tight">YT → MP3</h1>
          </div>
          {!online && (
            <span role="status" className="flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1 text-xs font-semibold text-warn">
              <WifiOff className="size-3.5" /> Mất kết nối
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-5 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-8">
        <div className={clsx("flex flex-col gap-6", tab !== "download" && "hidden lg:flex")}>
          <UrlForm />
          <QueueSection />
          <div className="lg:hidden">
            <RecentSection onSeeAll={() => setTab("history")} />
          </div>
        </div>
        <div className={clsx(tab !== "history" && "hidden lg:block")}>
          <HistorySection visible={tab === "history" || desktop} />
        </div>
      </main>

      <MiniPlayer />
      <BottomNav tab={tab} onChange={setTab} unseen={unseen} active={activeCount} />
    </div>
  );
}

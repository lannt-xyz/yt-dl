import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { EventsProvider } from "./state/events";
import { JobsProvider } from "./state/jobs";
import { PlayerProvider } from "./state/player";
import { ToastProvider } from "./state/toast";
import { TrimProvider } from "./state/trim";
import { YtdlpProvider } from "./state/ytdlp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <EventsProvider>
        <PlayerProvider>
          <JobsProvider>
            <YtdlpProvider>
              <TrimProvider>
                <App />
              </TrimProvider>
            </YtdlpProvider>
          </JobsProvider>
        </PlayerProvider>
      </EventsProvider>
    </ToastProvider>
  </StrictMode>,
);

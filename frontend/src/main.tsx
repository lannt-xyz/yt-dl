import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { JobsProvider } from "./state/jobs";
import { PlayerProvider } from "./state/player";
import { ToastProvider } from "./state/toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <PlayerProvider>
        <JobsProvider>
          <App />
        </JobsProvider>
      </PlayerProvider>
    </ToastProvider>
  </StrictMode>,
);

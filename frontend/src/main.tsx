import React from "react";
import ReactDOM from "react-dom/client";
import {ErrorBoundary} from "@/components/ErrorBoundary";
import {Providers} from "@/components/Providers";
import {Shell} from "@/components/Shell";
import App from "@/App";
import MaintenancePage from "@/app/maintenance/page";
import "@/app/globals.css";

const maintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === "true"
  || import.meta.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {maintenanceMode ? (
      <MaintenancePage />
    ) : (
      <ErrorBoundary>
        <Providers>
          <Shell>
            <App />
          </Shell>
        </Providers>
      </ErrorBoundary>
    )}
  </React.StrictMode>
);

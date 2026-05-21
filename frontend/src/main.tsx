import React from "react";
import ReactDOM from "react-dom/client";
import {ErrorBoundary} from "@/components/ErrorBoundary";
import {Providers} from "@/components/Providers";
import {Shell} from "@/components/Shell";
import App from "@/App";
import "@/app/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Providers>
        <Shell>
          <App />
        </Shell>
      </Providers>
    </ErrorBoundary>
  </React.StrictMode>
);

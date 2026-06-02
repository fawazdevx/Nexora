import "@rainbow-me/rainbowkit/styles.css";

import {darkTheme, getDefaultConfig, RainbowKitProvider} from "@rainbow-me/rainbowkit";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {useMemo, useState} from "react";
import {Toaster} from "react-hot-toast";
import {WagmiProvider} from "wagmi";
import {supportedChains} from "@/lib/arc";
import {NotificationsProvider} from "@/components/Notifications";

export function Providers({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(() => new QueryClient());
  const config = useMemo(
    () =>
      getDefaultConfig({
        appName: "Nexora",
        projectId: import.meta.env.VITE_WC_PROJECT_ID || "NEXORA_DEV_PROJECT_ID",
        chains: supportedChains,
        ssr: false
      }),
    []
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#2ee8ff",
            accentColorForeground: "#041016",
            borderRadius: "small",
            fontStack: "system"
          })}
        >
          <NotificationsProvider>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4500,
                style: {
                  maxWidth: "380px",
                  border: "1px solid rgba(45, 212, 191, 0.28)",
                  background: "rgba(8, 9, 13, 0.94)",
                  color: "rgba(255, 255, 255, 0.94)",
                  boxShadow: "0 18px 50px rgba(0, 0, 0, 0.38)",
                  backdropFilter: "blur(14px)"
                },
                success: {
                  iconTheme: {
                    primary: "#2dd4bf",
                    secondary: "#07100f"
                  }
                },
                error: {
                  iconTheme: {
                    primary: "#fb7185",
                    secondary: "#18070b"
                  }
                }
              }}
            />
          </NotificationsProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

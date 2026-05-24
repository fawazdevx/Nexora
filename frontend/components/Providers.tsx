import "@rainbow-me/rainbowkit/styles.css";

import {darkTheme, getDefaultConfig, RainbowKitProvider} from "@rainbow-me/rainbowkit";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {useMemo, useState} from "react";
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
          <NotificationsProvider>{children}</NotificationsProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

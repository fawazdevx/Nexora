import {useEffect, useMemo, useState} from "react";
import LandingPage from "@/app/landing/page";
import HomePage from "@/app/page";
import AgentsPage from "@/app/agents/page";
import AgentMemoryPage from "@/app/memory/page";
import EarnPage from "@/app/earn/page";
import SwapPage from "@/app/swap/page";
import MarketplacePage from "@/app/marketplace/page";
import NewMarketplaceServicePage from "@/app/marketplace/new/page";
import MarketplaceServicePage from "@/app/marketplace/service/page";
import ApiDocsPage from "@/app/docs/api/page";
import BuildersPage from "@/app/builders/page";
import X402PlaygroundPage from "@/app/x402/playground/page";
import DeveloperDashboardPage from "@/app/developer/page";
import RevenuePage from "@/app/revenue/page";
import GatewayPage from "@/app/gateway/page";
import DeploymentDashboardPage from "@/app/admin/deployments/page";
import EscrowPage from "@/app/escrow/page";
import PaymentsPage from "@/app/payments/page";
import ReceiptPage from "@/app/receipts/page";
import IdentityPage from "@/app/identity/page";
import ReputationPage from "@/app/reputation/page";
import NotificationsSettingsPage from "@/app/settings/notifications/page";
import PoliciesPage from "@/app/settings/policies/page";
import MaintenancePage from "@/app/maintenance/page";
import {currentPath, NAVIGATE_EVENT, readNavigationPath} from "@/lib/router";

const routes: Record<string, React.ComponentType> = {
  "/": LandingPage,
  "/home": HomePage,
  "/app": HomePage,
  "/agents": AgentsPage,
  "/memory": AgentMemoryPage,
  "/earn": EarnPage,
  "/swap": SwapPage,
  "/marketplace": MarketplacePage,
  "/marketplace/new": NewMarketplaceServicePage,
  "/builders": BuildersPage,
  "/docs/api": ApiDocsPage,
  "/x402/playground": X402PlaygroundPage,
  "/developer": DeveloperDashboardPage,
  "/revenue": RevenuePage,
  "/gateway": GatewayPage,
  "/admin/deployments": DeploymentDashboardPage,
  "/escrow": EscrowPage,
  "/payments": PaymentsPage,
  "/identity": IdentityPage,
  "/reputation": ReputationPage,
  "/settings/notifications": NotificationsSettingsPage,
  "/settings/policies": PoliciesPage,
  "/maintenance": MaintenancePage
};

export default function App() {
  const [pathname, setPathname] = useState(() => currentPath());

  useEffect(() => {
    const handleLocation = (event: Event) => setPathname(readNavigationPath(event));
    window.addEventListener("popstate", handleLocation);
    window.addEventListener(NAVIGATE_EVENT, handleLocation);
    return () => {
      window.removeEventListener("popstate", handleLocation);
      window.removeEventListener(NAVIGATE_EVENT, handleLocation);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/app") {
      window.history.replaceState({}, "", "/home");
      setPathname("/home");
    }
  }, [pathname]);

  const Page = useMemo(() => routes[pathname] ?? null, [pathname]);

  if (Page) return <Page />;

  const serviceMatch = pathname.match(/^\/marketplace\/services\/([^/]+)$/);
  if (serviceMatch) return <MarketplaceServicePage serviceId={decodeURIComponent(serviceMatch[1])} />;

  const receiptMatch = pathname.match(/^\/receipts\/([^/]+)$/);
  if (receiptMatch) return <ReceiptPage receiptId={decodeURIComponent(receiptMatch[1])} />;

  return <LandingPage />;
}

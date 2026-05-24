import {useEffect, useMemo, useState} from "react";
import LandingPage from "@/app/landing/page";
import HomePage from "@/app/page";
import AgentsPage from "@/app/agents/page";
import EarnPage from "@/app/earn/page";
import MarketplacePage from "@/app/marketplace/page";
import NewMarketplaceServicePage from "@/app/marketplace/new/page";
import DeveloperDashboardPage from "@/app/developer/page";
import EscrowPage from "@/app/escrow/page";
import PaymentsPage from "@/app/payments/page";
import IdentityPage from "@/app/identity/page";
import ReputationPage from "@/app/reputation/page";
import PoliciesPage from "@/app/settings/policies/page";
import MaintenancePage from "@/app/maintenance/page";
import {currentPath, NAVIGATE_EVENT, readNavigationPath} from "@/lib/router";

const routes: Record<string, React.ComponentType> = {
  "/": LandingPage,
  "/app": HomePage,
  "/agents": AgentsPage,
  "/earn": EarnPage,
  "/marketplace": MarketplacePage,
  "/marketplace/new": NewMarketplaceServicePage,
  "/developer": DeveloperDashboardPage,
  "/escrow": EscrowPage,
  "/payments": PaymentsPage,
  "/identity": IdentityPage,
  "/reputation": ReputationPage,
  "/settings/policies": PoliciesPage,
  "/maintenance": MaintenancePage
};

export default function App() {
  const [pathname, setPathname] = useState(() => currentPath());
  const maintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === "true";

  useEffect(() => {
    const handleLocation = (event: Event) => setPathname(readNavigationPath(event));
    window.addEventListener("popstate", handleLocation);
    window.addEventListener(NAVIGATE_EVENT, handleLocation);
    return () => {
      window.removeEventListener("popstate", handleLocation);
      window.removeEventListener(NAVIGATE_EVENT, handleLocation);
    };
  }, []);

  const Page = useMemo(() => routes[pathname] ?? LandingPage, [pathname]);

  if (maintenanceMode && pathname !== "/maintenance") {
    return <MaintenancePage />;
  }

  return <Page />;
}

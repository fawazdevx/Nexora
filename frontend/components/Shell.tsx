import {useEffect, useState} from "react";
import {Activity, RadioTower, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {navItems} from "@/lib/data";
import {currentPath, navigateTo, NAVIGATE_EVENT, readNavigationPath} from "@/lib/router";
import {WalletConnect} from "@/components/WalletConnect";
import {Footer} from "@/components/Footer";
import {NotificationsButton} from "@/components/Notifications";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

export function Shell({children}: {children: React.ReactNode}) {
  const [pathname, setPathname] = useState(() => currentPath());
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const publicPage = pathname === "/" || pathname === "/maintenance";

  useEffect(() => {
    const handleLocation = (event: Event) => setPathname(readNavigationPath(event));
    window.addEventListener("popstate", handleLocation);
    window.addEventListener(NAVIGATE_EVENT, handleLocation);
    return () => {
      window.removeEventListener("popstate", handleLocation);
      window.removeEventListener(NAVIGATE_EVENT, handleLocation);
    };
  }, []);

  if (publicPage) {
    return (
      <div className="min-h-screen overflow-hidden bg-void text-slate-100">
        {children}
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-void text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(155,92,246,0.22),transparent_38rem),radial-gradient(circle_at_85%_45%,rgba(110,231,183,0.08),transparent_28rem),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_28%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40" />

      <header className="sticky top-0 z-30 border-b border-white/[0.1] bg-gradient-to-b from-void/95 to-void/90 px-3 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:px-4 md:px-6 md:py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 sm:gap-4">
          <a href="/app" onClick={(event) => navigate(event, "/app")} className="group flex w-[132px] shrink-0 items-center gap-2 transition-all duration-200 hover:scale-[1.02] sm:w-[220px] sm:gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-plasma/30 blur-lg transition-all duration-300 group-hover:bg-plasma/50" />
              <img src="/nexora-logo.svg" alt="Nexora" className="relative h-9 w-9 shrink-0 rounded-xl shadow-lg sm:h-11 sm:w-11" />
            </div>
            <div className="min-w-0">
              <div className="bg-gradient-to-r from-white to-slate-200 bg-clip-text whitespace-nowrap text-lg font-bold leading-none tracking-tight text-transparent min-[380px]:text-xl sm:text-2xl sm:leading-none">Nexora</div>
              <div className="mt-1 hidden text-sm font-medium text-slate-400 sm:block">
                {isConnected ? <ArcNameLabel address={address} fallback="Agent Finance Network" /> : "Agent Finance Network"}
              </div>
            </div>
          </a>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <NotificationsButton items={snapshot.data?.notifications ?? []} />
            </div>
            <WalletConnect />
          </div>
        </div>

        <nav className="mx-auto mt-4 flex max-w-[1440px] gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <a key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} className={active ? "nav-chip nav-chip-active" : "nav-chip"}>
                <Icon size={16} />
                {item.label}
              </a>
            );
          })}
        </nav>
      </header>

      <main className="relative px-4 py-8 md:px-6">
        <div className="mx-auto grid max-w-[1440px] gap-6 xl:grid-cols-[1fr_320px]">
          <section className="min-w-0 animate-fade-in">{children}</section>

          <aside className="hidden space-y-5 xl:block">
            <div className="panel group relative overflow-hidden">
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-plasma/[0.08] blur-3xl transition-all duration-500 group-hover:bg-plasma/[0.15]" />
              <div className="relative flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-orchid glow-text">
                <Activity size={15} />
                Operator
              </div>
              <div className="relative mt-4 rounded-xl border border-plasma/30 bg-gradient-to-br from-plasma/15 to-plasma/5 p-5 shadow-[0_0_24px_rgba(155,92,246,0.15)]">
                <p className="text-sm font-semibold text-slate-300">Connected identity</p>
                <p className="mt-3 truncate bg-gradient-to-r from-white to-slate-200 bg-clip-text text-2xl font-bold text-transparent">
                  <ArcNameLabel address={address} fallback="Connect wallet" />
                </p>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-orchid glow-text">
                <RadioTower size={15} />
                Arc deployment
              </div>
              <div className="mt-4 grid gap-2.5 text-base">
                <div className="surface flex items-center justify-between px-4 py-3.5">
                  <span className="font-medium text-slate-400">Gas asset</span>
                  <span className="font-semibold text-white">USDC</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3.5">
                  <span className="font-medium text-slate-400">Settlement</span>
                  <span className="font-semibold text-white">x402</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3.5">
                  <span className="font-medium text-slate-400">Policy</span>
                  <span className="font-semibold text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.4)]">Ready</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3.5">
                  <span className="font-medium text-slate-400">Agent wallets</span>
                  <span className="font-semibold text-white">Circle</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-bold text-white">
                <Sparkles size={19} className="text-orchid glow-text" />
                Agent activity
              </div>
              <div className="mt-4 space-y-2 text-[15px] leading-7 text-slate-300/95">
                <p>Review wallets, policy limits, API purchases, and payment receipts from one workspace.</p>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-bold text-white">
                <ShieldCheck size={19} className="text-mint drop-shadow-[0_0_12px_rgba(110,231,183,0.5)]" />
                Controls
              </div>
              <div className="mt-4 space-y-2 text-[15px] leading-7 text-slate-300/95">
                <p>Set spending caps and approved destinations before agents perform paid actions.</p>
                <p>Keep Save/Earn deposits separate from agent payment policies.</p>
              </div>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}

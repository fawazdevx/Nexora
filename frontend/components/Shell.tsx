import {useEffect, useState} from "react";
import {Activity, Menu, RadioTower, Search, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {navItems} from "@/lib/data";
import {currentPath, navigateTo, NAVIGATE_EVENT, readNavigationPath} from "@/lib/router";
import {WalletConnect} from "@/components/WalletConnect";
import {Footer} from "@/components/Footer";
import {NotificationsButton} from "@/components/Notifications";

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
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(155,92,246,0.18),transparent_34rem),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_24%)]" />

      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-void/88 px-4 py-4 backdrop-blur-xl md:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <a href="/app" onClick={(event) => navigate(event, "/app")} className="flex shrink-0 items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-plasma/25 bg-plasma/10 text-orchid">
              <Activity size={20} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-2xl font-semibold tracking-normal text-white">Nexora</div>
              <div className="mt-1 hidden text-sm text-slate-400 sm:block">
                {isConnected ? <ArcNameLabel address={address} fallback="Agent Finance Network" /> : "Agent Finance Network"}
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.035] p-1 2xl:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <a key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} className={active ? "nav-item nav-item-active" : "nav-item"}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-[15px] text-slate-400 min-[1700px]:flex">
              <Search size={16} />
              <span className="w-52 truncate">Search agents, markets, policies</span>
            </div>
            <NotificationsButton />
            <WalletConnect />
          </div>
        </div>

        <nav className="mx-auto mt-3 flex max-w-[1440px] gap-2 overflow-x-auto 2xl:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <a key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} className={active ? "nav-chip nav-chip-active" : "nav-chip"}>
                <Icon size={15} />
                {item.label}
              </a>
            );
          })}
          <span className="nav-chip"><Menu size={15} /> More</span>
        </nav>
      </header>

      <main className="relative px-4 py-6 md:px-6">
        <div className="mx-auto grid max-w-[1440px] gap-6 xl:grid-cols-[1fr_300px]">
          <section className="min-w-0">{children}</section>

          <aside className="hidden space-y-5 xl:block">
            <div className="panel">
              <div className="flex items-center gap-2 text-sm uppercase tracking-[0.16em] text-orchid">
                <Activity size={14} />
                Operator
              </div>
              <div className="mt-4 rounded-lg border border-plasma/20 bg-plasma/10 p-4">
                <p className="text-sm text-slate-300">Connected identity</p>
                <p className="mt-2 truncate text-2xl font-semibold text-white">
                  <ArcNameLabel address={address} fallback="Connect wallet" />
                </p>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-sm uppercase tracking-[0.16em] text-orchid">
                <RadioTower size={14} />
                Arc deployment
              </div>
              <div className="mt-4 grid gap-2 text-base">
                <div className="surface flex items-center justify-between px-4 py-3">
                  <span className="text-slate-400">Gas asset</span>
                  <span className="text-white">USDC</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3">
                  <span className="text-slate-400">Settlement</span>
                  <span className="text-white">x402</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3">
                  <span className="text-slate-400">Policy</span>
                  <span className="text-mint">Ready</span>
                </div>
                <div className="surface flex items-center justify-between px-4 py-3">
                  <span className="text-slate-400">Agent wallets</span>
                  <span className="text-white">Circle</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-medium text-white">
                <Sparkles size={18} className="text-orchid" />
                Agent activity
              </div>
              <div className="mt-4 space-y-2 text-base leading-7 text-slate-300">
                <p>Review wallets, policy limits, API purchases, and payment receipts from one workspace.</p>
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-medium text-white">
                <ShieldCheck size={18} className="text-mint" />
                Controls
              </div>
              <div className="mt-4 space-y-2 text-base leading-7 text-slate-300">
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

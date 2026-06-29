import {useEffect, useState} from "react";
import {Activity, RadioTower, Search, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {findNav} from "@/lib/data";
import {currentPath, navigateTo, NAVIGATE_EVENT, readNavigationPath} from "@/lib/router";
import {WalletConnect} from "@/components/WalletConnect";
import {Footer} from "@/components/Footer";
import {NotificationsButton} from "@/components/Notifications";
import {HeaderNav, MobileNav} from "@/components/HeaderNav";
import {CommandPalette} from "@/components/CommandPalette";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

export function Shell({children}: {children: React.ReactNode}) {
  const [pathname, setPathname] = useState(() => currentPath());
  const [scrolled, setScrolled] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const {address} = useAccount();
  const snapshot = useAppSnapshot();
  const publicPage = pathname === "/" || pathname === "/maintenance";
  const activeNav = findNav(pathname);

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
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, {passive: true});
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

      <header className={`sticky top-0 z-30 border-b border-white/[0.1] bg-gradient-to-b from-void/95 to-void/90 px-3 backdrop-blur-2xl transition-all duration-300 sm:px-4 md:px-6 ${scrolled ? "py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]" : "py-3 md:py-4"}`}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-plasma/40 to-transparent" />
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 sm:gap-4">
          <a href="/home" onClick={(event) => navigate(event, "/home")} className="group flex shrink-0 items-center gap-2.5">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-plasma to-violet text-sm font-bold text-white shadow-[0_0_18px_rgba(155,92,246,0.3)] transition-transform duration-200 group-hover:scale-105">
              N
              <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
            </span>
            <img src="/nexora-wordmark-tight.png" alt="Nexora" className={`hidden w-auto transition-all duration-300 sm:block ${scrolled ? "h-5" : "h-6 sm:h-7"}`} />
          </a>

          <HeaderNav pathname={pathname} />

          {activeNav ? (
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <span className="h-4 w-px bg-white/[0.14]" />
              {activeNav.group ? <span className="hidden text-sm font-medium text-slate-500 sm:inline">{activeNav.group} ·</span> : null}
              <span className="truncate text-sm font-semibold text-white">{activeNav.item.label}</span>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-sm text-slate-400 transition hover:border-plasma/30 hover:text-white md:flex"
            >
              <Search size={15} />
              <span>Search</span>
              <kbd className="rounded-md border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-slate-500">⌘K</kbd>
            </button>
            <button type="button" onClick={() => setPaletteOpen(true)} className="secondary-button min-h-11 px-3 md:hidden" aria-label="Search">
              <Search size={16} />
            </button>
            <NotificationsButton items={snapshot.data?.notifications ?? []} />
            <WalletConnect />
            <MobileNav pathname={pathname} />
          </div>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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

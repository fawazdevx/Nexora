import {useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion} from "framer-motion";
import {ChevronDown, Menu, X} from "lucide-react";
import {homeItem, isNavActive, navGroups} from "@/lib/data";
import {navigateTo} from "@/lib/router";

function go(event: React.MouseEvent<HTMLAnchorElement>, href: string, after?: () => void) {
  event.preventDefault();
  navigateTo(href);
  after?.();
}

/** Desktop grouped dropdown nav with a sliding active indicator. */
export function HeaderNav({pathname}: {pathname: string}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const homeActive = pathname === "/home" || pathname === "/app" || pathname === "/";

  return (
    <nav className="hidden items-center gap-1 lg:flex">
      <a
        href={homeItem.href}
        onClick={(event) => go(event, homeItem.href)}
        className="relative rounded-xl px-3 py-2 text-[14px] font-medium"
      >
        {homeActive ? (
          <motion.span
            layoutId="nav-pill"
            className="absolute inset-0 rounded-xl border border-plasma/40 bg-gradient-to-br from-plasma/[0.16] to-plasma/[0.08] shadow-[0_0_20px_rgba(155,92,246,0.15)]"
            transition={{type: "spring", stiffness: 400, damping: 32}}
          />
        ) : null}
        <span className={`relative transition-colors ${homeActive ? "text-white" : "text-slate-300 hover:text-white"}`}>Home</span>
      </a>

      {navGroups.map((group) => {
        const groupActive = group.items.some((item) => isNavActive(pathname, item.href));
        const isOpen = openGroup === group.label;
        return (
          <div
            key={group.label}
            className="relative"
            onMouseEnter={() => setOpenGroup(group.label)}
            onMouseLeave={() => setOpenGroup(null)}
          >
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.label)}
              className="relative flex items-center gap-1 rounded-xl px-3 py-2 text-[14px] font-medium"
            >
              {groupActive ? (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-xl border border-plasma/40 bg-gradient-to-br from-plasma/[0.16] to-plasma/[0.08] shadow-[0_0_20px_rgba(155,92,246,0.15)]"
                  transition={{type: "spring", stiffness: 400, damping: 32}}
                />
              ) : null}
              <span className={`relative transition-colors ${groupActive || isOpen ? "text-white" : "text-slate-300"}`}>{group.label}</span>
              <ChevronDown size={14} className={`relative transition-transform duration-200 ${isOpen ? "rotate-180 text-white" : "text-slate-500"}`} />
            </button>

            <AnimatePresence>
              {isOpen ? (
                <motion.div
                  className="absolute left-0 top-full z-50 pt-2"
                  initial={{opacity: 0, y: 6}}
                  animate={{opacity: 1, y: 0}}
                  exit={{opacity: 0, y: 6}}
                  transition={{duration: 0.15, ease: [0.22, 1, 0.36, 1]}}
                >
                  <div className="w-64 overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isNavActive(pathname, item.href);
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          onClick={(event) => go(event, item.href, () => setOpenGroup(null))}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${active ? "bg-plasma/15" : "hover:bg-white/[0.05]"}`}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? "border-plasma/30 bg-plasma/10 text-orchid" : "border-white/[0.08] bg-white/[0.04] text-slate-400"}`}>
                            <Icon size={17} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{item.label}</p>
                            <p className="truncate text-xs text-slate-500">{item.description}</p>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </nav>
  );
}

/** Mobile/tablet slide-in menu shown below the lg breakpoint. */
export function MobileNav({pathname}: {pathname: string}) {
  const [open, setOpen] = useState(false);
  const homeActive = pathname === "/home" || pathname === "/app" || pathname === "/";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="secondary-button min-h-11 px-3 lg:hidden" aria-label="Open menu">
        <Menu size={18} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open ? (
            <div className="fixed inset-0 z-[70] lg:hidden">
              <motion.button
                type="button"
                className="absolute inset-0 bg-black/55 backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                transition={{duration: 0.2}}
              />
              <motion.aside
                className="absolute right-0 top-0 flex h-full w-[min(360px,100vw)] flex-col overflow-y-auto border-l border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-5 scrollbar-hide"
                initial={{x: "100%"}}
                animate={{x: 0}}
                exit={{x: "100%"}}
                transition={{type: "spring", stiffness: 320, damping: 34}}
              >
                <div className="flex items-center justify-between">
                  <img src="/nexora-wordmark-tight.png" alt="Nexora" className="h-6 w-auto" />
                  <button type="button" onClick={() => setOpen(false)} className="secondary-button min-h-10 px-3" aria-label="Close menu">
                    <X size={16} />
                  </button>
                </div>

                <a
                  href={homeItem.href}
                  onClick={(event) => go(event, homeItem.href, () => setOpen(false))}
                  className={`mt-6 flex items-center gap-3 rounded-xl px-3 py-2.5 ${homeActive ? "bg-plasma/15 text-white" : "text-slate-300 hover:bg-white/[0.05]"}`}
                >
                  <homeItem.icon size={18} className={homeActive ? "text-orchid" : "text-slate-400"} />
                  <span className="text-sm font-semibold">Home</span>
                </a>

                {navGroups.map((group) => (
                  <div key={group.label} className="mt-5">
                    <p className="px-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{group.label}</p>
                    <div className="mt-2 grid gap-1">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isNavActive(pathname, item.href);
                        return (
                          <a
                            key={item.href}
                            href={item.href}
                            onClick={(event) => go(event, item.href, () => setOpen(false))}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${active ? "bg-plasma/15 text-white" : "text-slate-300 hover:bg-white/[0.05]"}`}
                          >
                            <Icon size={18} className={active ? "text-orchid" : "text-slate-400"} />
                            <span className="text-sm font-medium">{item.label}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </motion.aside>
            </div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

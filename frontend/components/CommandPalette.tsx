import {useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion} from "framer-motion";
import {CornerDownLeft, Search} from "lucide-react";
import {allNavItems} from "@/lib/data";
import {navigateTo} from "@/lib/router";

export function CommandPalette({open, onClose}: {open: boolean; onClose: () => void}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNavItems;
    return allNavItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const target = results[index];
        if (target) {
          navigateTo(target.href);
          onClose();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, index, onClose]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
          <motion.button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close search"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.18}}
          />
          <motion.div
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            initial={{opacity: 0, y: -12, scale: 0.98}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -12, scale: 0.98}}
            transition={{duration: 0.18, ease: [0.22, 1, 0.36, 1]}}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
              <Search size={18} className="shrink-0 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages…"
                className="w-full bg-transparent py-4 text-[15px] text-white outline-none placeholder:text-slate-500"
              />
              <kbd className="shrink-0 rounded-md border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-slate-500">ESC</kbd>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2 scrollbar-hide">
              {results.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-slate-500">No pages match “{query}”.</p>
              ) : (
                results.map((item, position) => {
                  const Icon = item.icon;
                  const active = position === index;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onMouseEnter={() => setIndex(position)}
                      onClick={() => {
                        navigateTo(item.href);
                        onClose();
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "border border-plasma/30 bg-plasma/15" : "border border-transparent hover:bg-white/[0.04]"}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? "border-plasma/30 bg-plasma/10 text-orchid" : "border-white/[0.08] bg-white/[0.04] text-slate-400"}`}>
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{item.label}</p>
                        <p className="truncate text-xs text-slate-500">{item.description}</p>
                      </div>
                      {active ? <CornerDownLeft size={14} className="shrink-0 text-slate-500" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

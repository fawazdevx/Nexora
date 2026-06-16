import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ChevronDown} from "lucide-react";
import {AgentAvatar} from "@/components/AgentAvatar";
import {shortAddress} from "@/lib/arc";

export type PickerAgent = {
  id: string;
  arcName: string | null;
  address: string | null;
  operatorAddress: string;
  circleWalletStatus: string;
};

function agentLabel(agent: PickerAgent) {
  return agent.arcName ?? shortAddress(agent.operatorAddress);
}

function isReady(agent: PickerAgent) {
  return Boolean(agent.address) || agent.circleWalletStatus === "ready";
}

/** Avatar-rich agent selector that replaces the native <select>. */
export function AgentPicker({agents, value, onChange}: {agents: PickerAgent[]; value?: PickerAgent; onChange: (id: string) => void}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{top: number; left: number; width: number} | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({top: rect.bottom + 8, left: rect.left, width: rect.width});
  }

  function toggle() {
    if (agents.length === 0) return;
    if (!open) place();
    setOpen((current) => !current);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={agents.length === 0}
        className="flex min-w-[260px] items-center gap-3 rounded-xl border border-white/[0.12] bg-white/[0.06] py-2 pl-2 pr-3 transition hover:border-plasma/40 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {value ? (
          <>
            <AgentAvatar seed={value.address ?? value.id} label={value.arcName ?? value.address} size={32} />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-semibold text-white">{agentLabel(value)}</p>
              <p className="truncate text-xs text-slate-500">{value.address ? shortAddress(value.address) : "Circle pending"}</p>
            </div>
            <span className={`h-2 w-2 shrink-0 rounded-full ${isReady(value) ? "bg-mint" : "bg-amber"}`} />
          </>
        ) : (
          <span className="flex-1 text-left text-sm font-medium text-slate-400">No agent wallet yet</span>
        )}
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={menuRef}
              style={{top: coords.top, left: coords.left, width: coords.width}}
              className="fixed z-[80] max-h-72 overflow-y-auto rounded-xl border border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl scrollbar-hide"
            >
              {agents.map((agent) => {
                const active = agent.id === value?.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onChange(agent.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${active ? "bg-plasma/15" : "hover:bg-white/[0.05]"}`}
                  >
                    <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{agentLabel(agent)}</p>
                      <p className="truncate text-xs text-slate-500">{agent.address ? shortAddress(agent.address) : "Circle pending"}</p>
                    </div>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${isReady(agent) ? "bg-mint" : "bg-amber"}`} />
                    {active ? <Check size={15} className="shrink-0 text-mint" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

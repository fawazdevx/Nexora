import {ChevronDown} from "lucide-react";
import {useState} from "react";
import {useAccount} from "wagmi";
import {supportedChains, switchToChain} from "@/lib/arc";

export function ChainSwitcher() {
  const {chain} = useAccount();
  const [status, setStatus] = useState("");

  async function selectChain(chainId: string) {
    const target = supportedChains.find((item) => String(item.id) === chainId);
    if (!target) return;
    setStatus("");
    try {
      await switchToChain(target);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Network switch failed");
    }
  }

  if (supportedChains.length <= 1) return null;

  return (
    <div className="hidden min-w-[170px] lg:block">
      <label className="relative block">
        <span className="sr-only">Network</span>
        <select
          className="field min-h-11 w-full appearance-none py-2 pl-3 pr-9 text-sm"
          value={String(chain?.id ?? supportedChains[0].id)}
          onChange={(event) => void selectChain(event.target.value)}
        >
          {supportedChains.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
      </label>
      {status ? <p className="mt-1 max-w-[170px] truncate text-xs text-magenta">{status}</p> : null}
    </div>
  );
}

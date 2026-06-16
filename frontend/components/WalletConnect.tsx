import {ConnectButton} from "@rainbow-me/rainbowkit";
import {CheckCircle2, Wallet} from "lucide-react";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {shortAddress} from "@/lib/arc";

export function WalletConnect() {
  return (
    <ConnectButton.Custom>
      {({account, chain, mounted, openAccountModal, openChainModal, openConnectModal}) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button type="button" onClick={openConnectModal} className="action-button min-h-10 whitespace-nowrap px-3 text-sm sm:min-h-11 sm:px-5 sm:text-base">
              <Wallet size={16} />
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className="danger-button min-h-10 whitespace-nowrap px-3 text-sm sm:min-h-11 sm:px-5 sm:text-base">
              Switch to Arc
            </button>
          );
        }

        return (
          <div className="flex min-h-10 min-w-0 flex-nowrap items-center justify-end overflow-hidden rounded-xl border border-white/[0.14] bg-gradient-to-br from-white/[0.06] to-white/[0.03] backdrop-blur-sm transition-all duration-200 hover:border-plasma/40 sm:min-h-11">
            <button
              type="button"
              onClick={openChainModal}
              className="hidden items-center gap-2 self-stretch whitespace-nowrap px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06] hover:text-white sm:inline-flex"
              aria-label="Switch network"
            >
              {chain.hasIcon && chain.iconUrl ? (
                <img src={chain.iconUrl} alt="" className="h-4 w-4 rounded-full" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-mint" />
              )}
              <span className="max-w-[96px] truncate">{chain.name}</span>
            </button>
            <span className="hidden h-5 w-px self-center bg-white/[0.12] sm:block" />
            <button
              type="button"
              onClick={openAccountModal}
              className="flex min-w-0 items-center gap-2 self-stretch whitespace-nowrap px-3 text-sm font-semibold text-white transition hover:bg-white/[0.06] sm:text-base"
            >
              <CheckCircle2 size={16} className="shrink-0 text-mint" />
              <span className="max-w-[112px] truncate sm:max-w-[150px]">
                <ArcNameLabel address={account.address} fallback={account.displayName || shortAddress(account.address)} />
              </span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

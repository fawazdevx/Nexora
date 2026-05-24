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
            <button type="button" onClick={openConnectModal} className="action-button whitespace-nowrap px-4 sm:px-5">
              <Wallet size={16} />
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className="danger-button whitespace-nowrap px-4 sm:px-5">
              Switch to Arc
            </button>
          );
        }

        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={openChainModal} className="secondary-button hidden whitespace-nowrap px-4 sm:inline-flex">
              {chain.hasIcon && chain.iconUrl ? (
                <img src={chain.iconUrl} alt="" className="h-4 w-4 rounded-full" />
              ) : null}
              {chain.name}
            </button>
            <button type="button" onClick={openAccountModal} className="secondary-button whitespace-nowrap px-4">
              <CheckCircle2 size={16} className="text-mint" />
              <span className="max-w-[150px] truncate">
                <ArcNameLabel address={account.address} fallback={account.displayName || shortAddress(account.address)} />
              </span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

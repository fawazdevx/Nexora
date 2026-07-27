"use client";

// Task 5 — BotChain via Meridian (frontend UI). A self-contained panel that runs
// the full Permit2 x402 flow for BOT Chain: switch chain, one-time Permit2
// allowance, sign the PermitWitnessTransferFrom typed data, then relay the payload
// to the backend facilitator endpoint (which forwards to Meridian). Distinct from the Arc
// EIP-3009 flow in the playground because BotChain's USDT has no transferWithAuthorization.

import {useEffect, useState} from "react";
import {CheckCircle2, PenLine, RefreshCw, ShieldCheck, XCircle} from "lucide-react";
import toast from "react-hot-toast";
import {createPublicClient, createWalletClient, custom, http, isAddress, parseUnits, type Address, type Hex} from "viem";
import {useAccount} from "wagmi";
import {JsonViewer, type JsonStatus} from "@/components/JsonViewer";
import {apiPost} from "@/lib/api";
import {botChainTestnetWagmiChain, switchToChain} from "@/lib/arc";
import {navigateTo} from "@/lib/router";
import {
  botchainMeridian,
  buildBotchainPaymentRequirements,
  buildMeridianPermit2Payload,
  buildPermit2WitnessTypedData,
  MAX_UINT256,
  PERMIT2_ADDRESS,
  permit2Erc20Abi,
  randomPermit2Nonce
} from "@/lib/permit2";
import {userFacingPaymentError} from "@/lib/user-errors";

type FlowStep = "idle" | "switching" | "checking" | "approving" | "signing" | "settling";

export function BotchainPaymentPanel() {
  const {address, chain, isConnected} = useAccount();
  const [amount, setAmount] = useState("0.01");
  const [resource, setResource] = useState("https://api.example.com/paid-report");
  const [step, setStep] = useState<FlowStep>("idle");
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState<JsonStatus | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);

  // Only mount the flow when the BotChain testnet is turned on for this build —
  // otherwise the chain is not in supportedChains and switching would fail.
  useEffect(() => {
    setEnabled(import.meta.env.VITE_ENABLE_BOTCHAIN_TESTNET === "true");
  }, []);

  const busy = step !== "idle";

  async function pay() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first.");
      return;
    }
    let value: bigint;
    try {
      value = parseUnits(amount.trim(), botchainMeridian.usdtDecimals);
    } catch {
      toast.error("Enter a valid USDT amount.");
      return;
    }
    if (value <= 0n) {
      toast.error("Amount must be greater than 0.");
      return;
    }
    if (!isAddress(resource.trim()) && !resource.trim().startsWith("http")) {
      toast.error("Enter a valid resource URL.");
      return;
    }

    setResult(null);
    setStatus(undefined);
    const toastId = toast.loading("Preparing BotChain payment…");
    try {
      // 1. Ensure the wallet is on BotChain testnet.
      if (chain?.id !== botChainTestnetWagmiChain.id) {
        setStep("switching");
        toast.loading("Switch to BOT Chain Testnet…", {id: toastId});
        await switchToChain(botChainTestnetWagmiChain);
      }

      if (!window.ethereum) throw new Error("No injected wallet found");
      const wallet = createWalletClient({
        account: address as Address,
        chain: botChainTestnetWagmiChain,
        transport: custom(window.ethereum)
      });
      const publicClient = createPublicClient({
        chain: botChainTestnetWagmiChain,
        transport: http(botChainTestnetWagmiChain.rpcUrls.default.http[0])
      });

      // 2. One-time Permit2 allowance on the USDT token. Permit2 pulls funds via
      //    the signed permit, so the ERC-20 approval targets Permit2, not the proxy.
      setStep("checking");
      toast.loading("Checking Permit2 allowance…", {id: toastId});
      const allowance = await publicClient.readContract({
        address: botchainMeridian.usdt,
        abi: permit2Erc20Abi,
        functionName: "allowance",
        args: [address as Address, PERMIT2_ADDRESS]
      });
      if (allowance < value) {
        setStep("approving");
        toast.loading("Approve USDT for Permit2 (one time)…", {id: toastId});
        const approveHash = await wallet.writeContract({
          address: botchainMeridian.usdt,
          abi: permit2Erc20Abi,
          functionName: "approve",
          args: [PERMIT2_ADDRESS, MAX_UINT256]
        });
        await publicClient.waitForTransactionReceipt({hash: approveHash});
      }

      // 3. Sign the Permit2 witness transfer. The witness binds the transfer to
      //    Meridian's facilitator so the signature cannot be redirected.
      setStep("signing");
      toast.loading("Sign the Permit2 authorization…", {id: toastId});
      const nonce = randomPermit2Nonce();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const typedData = buildPermit2WitnessTypedData({
        token: botchainMeridian.usdt,
        amount: value,
        facilitator: botchainMeridian.facilitator,
        chainId: botchainMeridian.chainId,
        nonce,
        deadline
      });
      const signature = (await wallet.signTypedData({
        account: address as Address,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message
      })) as Hex;

      // 4. Relay to the backend, which forwards to Meridian's settle API.
      setStep("settling");
      toast.loading("Settling via Meridian…", {id: toastId});
      const paymentPayload = buildMeridianPermit2Payload({
        network: botchainMeridian.network,
        signature,
        owner: address as Address,
        token: botchainMeridian.usdt,
        amount: value,
        facilitator: botchainMeridian.facilitator,
        nonce,
        deadline
      });
      const paymentRequirements = buildBotchainPaymentRequirements({
        amount: value,
        resource: resource.trim()
      });
      const settle = await apiPost<Record<string, unknown>>("/api/x402/facilitator-settle", {
        paymentPayload,
        paymentRequirements
      });
      const success = !(settle && typeof settle === "object" && settle.success === false);
      setResult(settle);
      setStatus({label: success ? "Settled" : "Settle failed", tone: success ? "ok" : "error"});
      if (success) {
        toast.success("BOT Chain payment settled with Nexora policy controls.", {id: toastId});
      } else {
        const reason = typeof settle.errorReason === "string" ? settle.errorReason : "The BOT Chain payment was not settled.";
        toast.error(reason, {id: toastId});
      }
    } catch (error) {
      const message = userFacingPaymentError(error, "The BOT Chain payment could not be completed.");
      setResult({error: message});
      setStatus({label: "Error", tone: "error"});
      toast.error(message, {id: toastId});
    } finally {
      setStep("idle");
    }
  }

  if (!enabled) return null;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">BotChain · Permit2</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Pay on BOT Chain via Meridian</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            BOT Chain USDT has no EIP-3009, so x402 settles through Meridian using a Permit2 witness signature.
            Nexora checks the connected EOA's policy before relay, then records spend, reputation, a receipt,
            and a notification after successful settlement.
          </p>
        </div>
        <span className="rounded-full border border-cyan/25 bg-cyan/10 px-3 py-1 text-xs font-semibold text-cyan">Testnet USDT</span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr_auto]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Resource</span>
          <input
            value={resource}
            onChange={(event) => setResource(event.target.value)}
            placeholder="https://api.example.com/paid-report"
            className="field mt-2 w-full font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Amount (USDT)</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="field mt-2 w-full"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            className="action-button min-h-12 w-full whitespace-nowrap"
            onClick={() => void pay()}
            disabled={!isConnected || busy}
          >
            {busy ? <RefreshCw size={16} className="animate-spin" /> : <PenLine size={16} />}
            {stepLabel(step)}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck size={14} className="text-cyan" />
        <span>
          Approval targets Permit2 ({PERMIT2_ADDRESS.slice(0, 6)}…{PERMIT2_ADDRESS.slice(-4)}); the witness binds
          the transfer to Meridian's facilitator, so a leaked signature cannot be redirected.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">
        <span>
          Nexora can enforce only payments routed through this guarded endpoint. Calling Meridian directly bypasses Nexora policy checks and receipts.
        </span>
        <button type="button" className="secondary-button min-h-9 px-3 py-1.5 text-xs" onClick={() => navigateTo("/settings/policies")}>
          <ShieldCheck size={14} /> Configure policy
        </button>
      </div>

      {status ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {status.tone === "ok" ? (
              <CheckCircle2 size={16} className="text-mint" />
            ) : (
              <XCircle size={16} className="text-magenta" />
            )}
            <span className={status.tone === "ok" ? "text-mint" : "text-magenta"}>{status.label}</span>
          </div>
          <JsonViewer title="POST /api/x402/facilitator-settle" code={JSON.stringify(result ?? {}, null, 2)} status={status} />
        </div>
      ) : null}
    </section>
  );
}

function stepLabel(step: FlowStep): string {
  switch (step) {
    case "switching":
      return "Switching chain…";
    case "checking":
      return "Checking allowance…";
    case "approving":
      return "Approving USDT…";
    case "signing":
      return "Signing…";
    case "settling":
      return "Settling…";
    default:
      return "Pay via Meridian";
  }
}

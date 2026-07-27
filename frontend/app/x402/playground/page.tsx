import {useEffect, useMemo, useState} from "react";
import {Activity, CheckCircle2, Copy, ExternalLink, KeyRound, PenLine, Play, RadioTower, RefreshCw, Search, Server, ShieldCheck, Users, XCircle} from "lucide-react";
import toast from "react-hot-toast";
import {isAddress, parseUnits, type Address, type Hex} from "viem";
import {useAccount, useSignTypedData} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {JsonViewer, type JsonStatus} from "@/components/JsonViewer";
import {apiGet, apiPost, apiUrlFor} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {arcTestnet, shortAddress, supportedChains, switchToArc, switchToChain} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {BotchainPaymentPanel} from "@/components/BotchainPaymentPanel";
import {SettlementPanel} from "@/components/SettlementPanel";
import {enabledX402SignNetworks, x402SignNetwork, type X402SignNetwork} from "@/lib/x402-networks";
import {readAgentChainBalances} from "@/lib/contracts";
import {userFacingPaymentError} from "@/lib/user-errors";

type Analytics = {
  summary: {
    verifications: number;
    settlements: number;
    failed: number;
    volumeUsdc: number;
    activeIntegrators: number;
  };
  recentEvents: Array<{
    id: string;
    kind: "verify" | "settle";
    status: "success" | "failed";
    payer?: string | null;
    payTo?: string | null;
    network?: string | null;
    amountUsdc?: number;
    requestHash?: string | null;
    reason?: string | null;
    txHash?: string | null;
    createdAt: string;
  }>;
};

type Readiness = {
  ready: boolean;
  missing: string[];
  items: Array<{
    key: string;
    label: string;
    configured: boolean;
    requiredFor: string;
  }>;
};

const sampleBody = {
  paymentRequirements: {
    scheme: "exact",
    network: "arc-testnet",
    maxAmountRequired: "50000",
    resource: "https://api.example.com/paid-report",
    description: "Paid report",
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000"
  },
  paymentPayload: {
    x402Version: 1,
    scheme: "exact",
    network: "arc-testnet",
    payload: {
      authorization: {
        from: "0xPayerWallet",
        to: "0xYourPublisherWallet",
        value: "50000",
        validAfter: "0",
        validBefore: "1893456000",
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000001"
      },
      signature: "0x..."
    }
  }
};

const emptySettleBody = {
  paymentRequirements: sampleBody.paymentRequirements,
  paymentPayload: sampleBody.paymentPayload
};

const endpoints: Array<{method: "GET" | "POST"; path: string}> = [
  {method: "GET", path: "/x402/supported"},
  {method: "POST", path: "/x402/verify"},
  {method: "POST", path: "/x402/settle"}
];

const sdkSnippet = `npm install @nexorafi/x402@0.3

import { nexoraX402 } from "@nexorafi/x402";

app.get("/paid-report",
  nexoraX402({
    facilitatorUrl: "${apiUrlFor("")}",
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    x402Version: 2
  }),
  (_req, res) => res.json({ ok: true })
);`;

type EventFilter = "all" | "verify" | "settle" | "success" | "failed";
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

export default function X402PlaygroundPage() {
  const {address, chain, isConnected} = useAccount();
  const {signTypedDataAsync, isPending: signing} = useSignTypedData();
  const [supported, setSupported] = useState<unknown>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requestText, setRequestText] = useState(() => JSON.stringify(sampleBody, null, 2));
  const [settleText, setSettleText] = useState(() => JSON.stringify(emptySettleBody, null, 2));
  const [verifyResult, setVerifyResult] = useState<unknown>(null);
  const [verifyStatus, setVerifyStatus] = useState<JsonStatus | undefined>(undefined);
  const [settleResult, setSettleResult] = useState<unknown>(null);
  const [settleStatus, setSettleStatus] = useState<JsonStatus | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [filter, setFilter] = useState<EventFilter>("all");
  const [query, setQuery] = useState("");
  const [signAmount, setSignAmount] = useState("0.01");
  const [signPayTo, setSignPayTo] = useState("");
  const [signNetworkId, setSignNetworkId] = useState("arc-testnet");
  const [protocolVersion, setProtocolVersion] = useState<1 | 2>(2);
  const [signerBalances, setSignerBalances] = useState<{usdc: string; native: string; nativeSymbol: string} | null>(null);
  const signNetworks = useMemo(() => enabledX402SignNetworks(), []);
  const selectedSignNetwork = x402SignNetwork(signNetworkId);
  const paymentHeaderPreview = useMemo(() => {
    try {
      const body = JSON.parse(requestText) as {paymentPayload?: unknown};
      if (!body.paymentPayload) return null;
      const payloadVersion = Number((body.paymentPayload as {x402Version?: unknown}).x402Version) === 2 ? 2 : 1;
      return {
        name: payloadVersion === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT",
        value: encodeBase64Json(body.paymentPayload)
      };
    } catch {
      return null;
    }
  }, [requestText]);
  const paymentRequiredPreview = useMemo(() => createPaymentRequiredPreview({
    version: protocolVersion,
    network: selectedSignNetwork,
    payTo: isAddress(signPayTo) ? signPayTo : address ?? "",
    amount: signAmount
  }), [protocolVersion, selectedSignNetwork, signPayTo, address, signAmount]);

  const jsonError = useMemo(() => {
    try {
      JSON.parse(requestText);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [requestText]);

  const settleJsonError = useMemo(() => {
    try {
      JSON.parse(settleText);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [settleText]);

  const curl = useMemo(() => {
    let body = requestText;
    try {
      body = JSON.stringify(JSON.parse(requestText));
    } catch {
      /* keep raw text if unparseable */
    }
    return `curl -X POST ${apiUrlFor("/x402/verify")} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  }, [requestText]);

  const settleCurl = useMemo(() => {
    let body = settleText;
    try {
      body = JSON.stringify(JSON.parse(settleText));
    } catch {
      /* keep raw text if unparseable */
    }
    return `curl -X POST ${apiUrlFor("/x402/settle")} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  }, [settleText]);

  async function refresh() {
    setRefreshing(true);
    try {
      const [supportedResult, analyticsResult, readinessResult] = await Promise.all([
        apiGet("/x402/supported"),
        apiGet<Analytics>("/api/x402/analytics"),
        apiGet<Readiness>("/api/readiness")
      ]);
      setSupported(supportedResult);
      setAnalytics(analyticsResult);
      setReadiness(readinessResult);
    } catch (error) {
      toast.error(userFacingPaymentError(error, "Facilitator console unavailable."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!signPayTo && address) setSignPayTo(address);
  }, [address, signPayTo]);

  useEffect(() => {
    if (!address || !selectedSignNetwork) {
      setSignerBalances(null);
      return;
    }
    let active = true;
    readAgentChainBalances(address, selectedSignNetwork.chainId)
      .then((value) => {
        if (active) setSignerBalances(value);
      })
      .catch(() => {
        if (active) setSignerBalances(null);
      });
    return () => {
      active = false;
    };
  }, [address, selectedSignNetwork]);

  async function signRealSample() {
    if (!isConnected || !address) {
      toast.error("Connect a wallet before signing an x402 sample.");
      return;
    }
    const payTo = signPayTo.trim() || address;
    if (!isAddress(payTo)) {
      toast.error("Enter a valid payTo wallet address.");
      return;
    }
    let value: bigint;
    try {
      value = parseUnits(signAmount.trim(), 6);
    } catch {
      toast.error("Enter a valid USDC amount.");
      return;
    }
    if (value <= 0n) {
      toast.error("Amount must be greater than 0 USDC.");
      return;
    }

    const network = x402SignNetwork(signNetworkId);
    if (!network) {
      toast.error("Select a supported network.");
      return;
    }

    if (chain?.id !== network.chainId) {
      const target = supportedChains.find((item) => item.id === network.chainId);
      if (!target) {
        toast.error(`${network.label} is not enabled in this build.`);
        return;
      }
      await switchToChain(target);
    }

    const now = Math.floor(Date.now() / 1000);
    const validAfter = Math.max(0, now - 30).toString();
    const validBefore = (now + 30 * 60).toString();
    const nonce = randomBytes32();
    const message = {
      from: address as Address,
      to: payTo as Address,
      value,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    };

    const toastId = toast.loading("Requesting wallet signature...");
    try {
      const signature = await signTypedDataAsync({
        domain: {
          name: network.domainName,
          version: network.domainVersion,
          chainId: network.chainId,
          verifyingContract: network.usdc
        },
        types: {
          TransferWithAuthorization: [
            {name: "from", type: "address"},
            {name: "to", type: "address"},
            {name: "value", type: "uint256"},
            {name: "validAfter", type: "uint256"},
            {name: "validBefore", type: "uint256"},
            {name: "nonce", type: "bytes32"}
          ]
        },
        primaryType: "TransferWithAuthorization",
        message
      });
      const signedBody = createSignedSampleBody({
        version: protocolVersion,
        network,
        from: address,
        to: payTo,
        value: value.toString(),
        validAfter,
        validBefore,
        nonce,
        signature
      });
      const text = JSON.stringify(signedBody, null, 2);
      setRequestText(text);
      setSettleText(text);
      setVerifyResult(null);
      setSettleResult(null);
      setVerifyStatus(undefined);
      setSettleStatus(undefined);
      toast.success(`Signed x402 v${protocolVersion} sample filled into verify and settle requests.`, {id: toastId});
    } catch (error) {
      toast.error(userFacingPaymentError(error, "The payment signature was not completed."), {id: toastId});
    }
  }

  async function runSampleVerify() {
    if (jsonError) {
      toast.error("Fix the request JSON before running.");
      return;
    }
    setRunning(true);
    const toastId = toast.loading("Sending verification request…");
    const startedAt = performance.now();
    try {
      const result = await apiPost<Record<string, unknown>>("/x402/verify", JSON.parse(requestText));
      const ms = Math.round(performance.now() - startedAt);
      const valid = !(result && typeof result === "object" && result.isValid === false);
      setVerifyResult(result);
      setVerifyStatus({label: valid ? "200 OK" : "200 · invalid", tone: valid ? "ok" : "error", detail: `${ms} ms`});
      toast.success("Verification response received.", {id: toastId});
      void refresh();
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      const message = userFacingPaymentError(error, "The payment authorization could not be verified.");
      setVerifyResult({error: message});
      setVerifyStatus({label: "Request failed", tone: "error", detail: `${ms} ms`});
      toast.error(message, {id: toastId});
    } finally {
      setRunning(false);
    }
  }

  async function runSampleSettle() {
    if (settleJsonError) {
      toast.error("Fix the settle JSON before running.");
      return;
    }
    setSettling(true);
    const toastId = toast.loading("Sending settlement request...");
    const startedAt = performance.now();
    try {
      const result = await apiPost<Record<string, unknown>>("/api/x402/facilitator-settle", JSON.parse(settleText));
      const ms = Math.round(performance.now() - startedAt);
      const success = Boolean(result?.success);
      setSettleResult(result);
      setSettleStatus({label: success ? "Settled" : "Not settled", tone: success ? "ok" : "error", detail: `${ms} ms`});
      toast[success ? "success" : "error"](success ? "Settlement submitted." : "Settlement rejected.", {id: toastId});
      void refresh();
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      const message = userFacingPaymentError(error, "The payment could not be settled.");
      setSettleResult({error: message});
      setSettleStatus({label: "Request failed", tone: "error", detail: `${ms} ms`});
      toast.error(message, {id: toastId});
    } finally {
      setSettling(false);
    }
  }

  const summary = analytics?.summary;
  const events = analytics?.recentEvents ?? [];
  const facilitatorItems = useMemo(() => {
    const keys = new Set(["DATABASE_URL", "FACILITATOR_PRIVATE_KEY", "X402_LEDGER_ADDRESS", "TREASURY_ADDRESS"]);
    return readiness?.items.filter((item) => keys.has(item.key)) ?? [];
  }, [readiness]);
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((event) => {
      if (filter === "verify" && event.kind !== "verify") return false;
      if (filter === "settle" && event.kind !== "settle") return false;
      if (filter === "success" && event.status !== "success") return false;
      if (filter === "failed" && event.status !== "failed") return false;
      if (!q) return true;
      return [event.payer, event.payTo, event.reason, event.txHash, event.requestHash, event.network]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [events, filter, query]);
  const ready = readiness?.ready ?? false;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="x402 facilitator"
        title="Facilitator console"
        description="Monitor supported x402 configuration, verify signed USDC authorizations, test settlement, and inspect live facilitator events."
        action={
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button className="secondary-button" onClick={() => navigateTo("/docs/api")}>API docs</button>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatMetric variant="panel" icon={RadioTower} label="Verifications" value={summary?.verifications ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={CheckCircle2} label="Settlements" value={summary?.settlements ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={XCircle} label="Failed" value={summary?.failed ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={Activity} label="Volume" value={summary?.volumeUsdc ?? 0} prefix="$" decimals={2} loading={loading} accent />
        <StatMetric variant="panel" icon={Users} label="Integrators" value={summary?.activeIntegrators ?? 0} loading={loading} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Operational readiness</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Facilitator health</h2>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${ready ? "border-mint/25 bg-mint/10 text-mint" : "border-amber/25 bg-amber/10 text-amber"}`}>
              {ready ? "Ready" : "Needs config"}
            </span>
          </div>
          <div className="mt-5 grid gap-2">
            {loading ? (
              [0, 1, 2, 3].map((index) => <div key={index} className="shimmer h-14 w-full rounded-xl" />)
            ) : facilitatorItems.length === 0 ? (
              <p className="text-sm text-slate-400">Readiness details are unavailable.</p>
            ) : (
              facilitatorItems.map((item) => (
                <div key={item.key} className="surface flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.requiredFor}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${item.configured ? "border-mint/25 bg-mint/10 text-mint" : "border-magenta/25 bg-magenta/10 text-magenta"}`}>
                    {item.configured ? "Configured" : "Missing"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">Live integration</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Developer endpoints</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Use these URLs in external API middleware, SDK examples, and manual tests.</p>
          <div className="mt-5 grid gap-2">
            {endpoints.map((endpoint) => (
              <div key={endpoint.path} className="surface flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${endpoint.method === "GET" ? "bg-cyan/15 text-cyan" : "bg-plasma/15 text-orchid"}`}>{endpoint.method}</span>
                  <span className="truncate font-mono text-sm text-white">{apiUrlFor(endpoint.path)}</span>
                </div>
                <CopyMini value={apiUrlFor(endpoint.path)} />
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniFact icon={<Server size={16} />} label="Networks" value="Arc · Base · Arbitrum" />
            <MiniFact icon={<ShieldCheck size={16} />} label="Scheme" value="exact" />
            <MiniFact icon={<KeyRound size={16} />} label="Asset" value="USDC" />
          </div>
        </div>
      </section>

      {/* Request → Response */}
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Signed demo</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Generate a real x402 authorization</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Pick a network and sign a small USDC authorization with your connected wallet. Verify should pass immediately. Settle submits the transferWithAuthorization transaction, so the signing wallet must hold at least this USDC amount — and on Base/Arbitrum the facilitator needs native ETH for gas.
            </p>
          </div>
          <span className="rounded-full border border-amber/25 bg-amber/10 px-3 py-1 text-xs font-semibold text-amber">Testnet USDC</span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[0.7fr_1fr_1.4fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Protocol</span>
            <select
              value={protocolVersion}
              onChange={(event) => setProtocolVersion(Number(event.target.value) as 1 | 2)}
              className="field mt-2 w-full"
            >
              <option value={2}>x402 v2</option>
              <option value={1}>x402 v1</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Network</span>
            <select
              value={signNetworkId}
              onChange={(event) => setSignNetworkId(event.target.value)}
              className="field mt-2 w-full"
            >
              {signNetworks.map((net) => <option key={net.id} value={net.id}>{net.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">payTo</span>
            <input
              value={signPayTo}
              onChange={(event) => setSignPayTo(event.target.value)}
              placeholder={address ?? "0xPublisherOrYourWallet"}
              className="field mt-2 w-full font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Amount</span>
            <input
              value={signAmount}
              onChange={(event) => setSignAmount(event.target.value)}
              inputMode="decimal"
              className="field mt-2 w-full"
            />
          </label>
          <div className="flex items-end">
            <button type="button" className="action-button min-h-12 w-full whitespace-nowrap" onClick={() => void signRealSample()} disabled={!isConnected || signing}>
              {signing ? <RefreshCw size={16} className="animate-spin" /> : <PenLine size={16} />}
              {signing ? "Signing..." : "Sign real sample"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Signer balance: {signerBalances ? `${Number(signerBalances.usdc).toFixed(4)} USDC · ${Number(signerBalances.native).toFixed(6)} ${signerBalances.nativeSymbol}` : "unavailable"} on {selectedSignNetwork?.label ?? "the selected network"}.
          Settle consumes the nonce. Base and Arbitrum settlement gas is paid by the configured facilitator wallet in ETH.
        </p>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="panel">
          <p className="section-kicker">Step 1 · 402</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Payment required</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">The protected API returns this challenge before any paid request is processed.</p>
          <div className="mt-4">
            <JsonViewer title="402-response.json" code={JSON.stringify(paymentRequiredPreview, null, 2)} maxHeight="300px" />
          </div>
        </div>
        <div className="panel">
          <p className="section-kicker">Step 2 · Sign</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Payment header</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">The signed payload is base64 encoded into the version-specific request header.</p>
          <div className="mt-4">
            <JsonViewer
              title="request-headers.json"
              code={JSON.stringify(paymentHeaderPreview ?? {message: "Sign a sample to generate the header."}, null, 2)}
              maxHeight="300px"
            />
          </div>
        </div>
        <div className="panel">
          <p className="section-kicker">Step 3 · Replay</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Verify and settle</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Replay the original request with the payment header, then inspect PAYMENT-RESPONSE or X-PAYMENT-RESPONSE.</p>
          <div className="mt-4">
            <JsonViewer
              title="response-headers.json"
              code={JSON.stringify({
                expected: protocolVersion === 2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE",
                settlement: settleResult ?? "Run settlement to inspect the receipt."
              }, null, 2)}
              maxHeight="300px"
            />
          </div>
        </div>
      </section>

      <BotchainPaymentPanel />

      <SettlementPanel />

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Verify endpoint</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Request</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => setRequestText(JSON.stringify(sampleBody, null, 2))}>Reset</button>
              <button className="action-button" onClick={() => void runSampleVerify()} disabled={running || Boolean(jsonError)}>
                {running ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">POST {apiUrlFor("/x402/verify")}</p>
          <textarea
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            spellCheck={false}
            className="mt-4 min-h-[320px] w-full rounded-xl border border-white/[0.1] bg-[#050813] p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none transition focus:border-plasma/50"
          />
          {jsonError ? <p className="mt-2 text-xs font-medium text-magenta">Invalid JSON: {jsonError}</p> : null}
        </div>

        <div className="panel">
          <p className="section-kicker">Response</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Latest verify result</h2>
          <div className="mt-5">
            <JsonViewer
              title="response.json"
              status={verifyStatus}
              code={JSON.stringify(verifyResult ?? {message: "Run the request to see a response."}, null, 2)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Settle endpoint</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Settlement request</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => setSettleText(JSON.stringify(emptySettleBody, null, 2))}>Reset</button>
              <button className="action-button" onClick={() => void runSampleSettle()} disabled={settling || Boolean(settleJsonError)}>
                {settling ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                {settling ? "Settling..." : "Settle"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">POST {apiUrlFor("/x402/settle")}</p>
          <textarea
            value={settleText}
            onChange={(event) => setSettleText(event.target.value)}
            spellCheck={false}
            className="mt-4 min-h-[320px] w-full rounded-xl border border-white/[0.1] bg-[#050813] p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none transition focus:border-plasma/50"
          />
          {settleJsonError ? <p className="mt-2 text-xs font-medium text-magenta">Invalid JSON: {settleJsonError}</p> : null}
        </div>

        <div className="panel">
          <p className="section-kicker">Settlement response</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Latest settle result</h2>
          <div className="mt-5">
            <JsonViewer
              title="settle-response.json"
              status={settleStatus}
              code={JSON.stringify(settleResult ?? {message: "Paste a signed authorization and run settlement."}, null, 2)}
            />
          </div>
          <div className="mt-4">
            <JsonViewer title="settle.curl" language="bash" code={settleCurl} maxHeight="170px" />
          </div>
        </div>
      </section>

      {/* Supported config + endpoints/curl */}
      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <p className="section-kicker">Supported config</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Facilitator response</h2>
          <div className="mt-5">
            <JsonViewer title="GET /x402/supported" code={JSON.stringify(supported ?? {}, null, 2)} />
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">SDK quickstart</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Protect an API route</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">This snippet points builders at your active Nexora facilitator backend.</p>
          <div className="mt-5">
            <JsonViewer title="server.ts" language="ts" code={sdkSnippet} maxHeight="340px" />
          </div>
          <div className="mt-4">
            <JsonViewer title="verify.curl" language="bash" code={curl} maxHeight="180px" />
          </div>
        </div>
      </section>

      {/* Events feed */}
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Recent facilitator events</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Live activity</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search payer, tx, reason"
                className="h-10 w-60 rounded-lg border border-white/[0.1] bg-white/[0.04] pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-plasma/45"
              />
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as EventFilter)}
              className="h-10 rounded-lg border border-white/[0.1] bg-[#0b1020] px-3 text-sm font-medium text-slate-200 outline-none transition focus:border-plasma/45"
            >
              <option value="all">All events</option>
              <option value="verify">Verify</option>
              <option value="settle">Settle</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div className="mt-5">
          {loading ? (
            <div className="grid gap-2">
              {[0, 1, 2, 3].map((index) => <div key={index} className="shimmer h-14 w-full rounded-xl" />)}
            </div>
          ) : filteredEvents.length === 0 ? (
            <EmptyState icon={<Activity size={24} />} title="No facilitator events yet" copy="Run a verification or settle a payment through the SDK to see live facilitator activity here." className="border-0 bg-transparent p-0 shadow-none" />
          ) : (
            <div className="grid gap-2">
              {filteredEvents.slice(0, 16).map((event) => {
                const ok = event.status === "success";
                const Icon = event.kind === "settle" ? CheckCircle2 : RadioTower;
                return (
                  <div key={event.id} className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${ok ? "border-mint/20 bg-mint/10 text-mint" : "border-magenta/20 bg-magenta/10 text-magenta"}`}>
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold capitalize text-white">{event.kind} · ${event.amountUsdc ?? 0}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span>{timeAgo(event.createdAt)}</span>
                          {event.payer ? <><span className="text-slate-700">·</span><span className="font-mono">{shortAddress(event.payer)}</span></> : null}
                          {event.payTo ? <><span className="text-slate-700">→</span><span className="font-mono">{shortAddress(event.payTo)}</span></> : null}
                          {event.reason ? <><span className="text-slate-700">·</span><span className="truncate">{event.reason}</span></> : null}
                          {event.txHash ? (
                            <a href={`${explorerForNetwork(event.network).replace(/\/$/, "")}/tx/${event.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orchid transition hover:text-white">
                              View tx <ExternalLink size={11} />
                            </a>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${ok ? "border-mint/25 bg-mint/10 text-mint" : "border-magenta/25 bg-magenta/10 text-magenta"}`}>{event.status}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MiniFact({icon, label, value}: {icon: React.ReactNode; label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 font-semibold text-white">{value}</p>
    </div>
  );
}

function createSignedSampleBody(input: {
  version: 1 | 2;
  network: X402SignNetwork;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
}) {
  if (input.version === 2) {
    const accepted = {
      scheme: "exact",
      network: `eip155:${input.network.chainId}`,
      amount: input.value,
      payTo: input.to,
      maxTimeoutSeconds: 120,
      asset: input.network.usdc,
      extra: {
        name: input.network.domainName,
        version: input.network.domainVersion
      }
    };
    return {
      paymentRequirements: accepted,
      paymentPayload: {
        x402Version: 2,
        resource: {
          url: "https://api.example.com/nexora-showcase-report",
          description: "Nexora signed x402 showcase report",
          mimeType: "application/json"
        },
        accepted,
        payload: {
          authorization: {
            from: input.from,
            to: input.to,
            value: input.value,
            validAfter: input.validAfter,
            validBefore: input.validBefore,
            nonce: input.nonce
          },
          signature: input.signature
        }
      }
    };
  }
  return {
    paymentRequirements: {
      scheme: "exact",
      network: input.network.id,
      maxAmountRequired: input.value,
      resource: "https://api.example.com/nexora-showcase-report",
      description: "Nexora signed x402 showcase report",
      payTo: input.to,
      asset: input.network.usdc,
      extra: {
        name: input.network.domainName,
        version: input.network.domainVersion
      }
    },
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network: input.network.id,
      payload: {
        authorization: {
          from: input.from,
          to: input.to,
          value: input.value,
          validAfter: input.validAfter,
          validBefore: input.validBefore,
          nonce: input.nonce
        },
        signature: input.signature
      }
    }
  };
}

function createPaymentRequiredPreview(input: {
  version: 1 | 2;
  network?: X402SignNetwork;
  payTo: string;
  amount: string;
}) {
  if (!input.network || !isAddress(input.payTo)) return {message: "Connect a wallet and select a valid payment recipient."};
  let amount = "0";
  try {
    amount = parseUnits(input.amount || "0", 6).toString();
  } catch {
    // Keep the preview usable while the amount field is being edited.
  }
  const common = {
    scheme: "exact",
    network: input.version === 2 ? `eip155:${input.network.chainId}` : input.network.id,
    payTo: input.payTo,
    asset: input.network.usdc,
    maxTimeoutSeconds: 120,
    extra: {name: input.network.domainName, version: input.network.domainVersion}
  };
  return input.version === 2
    ? {
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: "https://api.example.com/nexora-showcase-report",
        description: "Nexora signed x402 showcase report",
        mimeType: "application/json"
      },
      accepts: [{...common, amount}]
    }
    : {
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: [{
        ...common,
        maxAmountRequired: amount,
        resource: "https://api.example.com/nexora-showcase-report",
        description: "Nexora signed x402 showcase report",
        mimeType: "application/json"
      }]
    };
}

function encodeBase64Json(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function explorerForNetwork(network?: string | null) {
  const signNetwork = enabledX402SignNetworks().find((item) => item.id === network || `eip155:${item.chainId}` === network);
  const chain = supportedChains.find((item) => item.id === signNetwork?.chainId);
  return chain?.blockExplorers.default.url ?? arcTestnet.explorerUrl;
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function CopyMini({value}: {value: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied URL");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 text-slate-500 transition hover:text-white" aria-label="Copy endpoint URL">
      {copied ? <CheckCircle2 size={14} className="text-mint" /> : <Copy size={14} />}
    </button>
  );
}

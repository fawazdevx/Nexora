import {useEffect, useState} from "react";
import {Activity, CheckCircle2, Play, RadioTower, XCircle} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet, apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";

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
    amountUsdc?: number;
    reason?: string | null;
    txHash?: string | null;
    createdAt: string;
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

export default function X402PlaygroundPage() {
  const [supported, setSupported] = useState<unknown>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [verifyResult, setVerifyResult] = useState<unknown>(null);
  const [status, setStatus] = useState("");

  async function refresh() {
    const [supportedResult, analyticsResult] = await Promise.all([
      apiGet("/x402/supported"),
      apiGet<Analytics>("/api/x402/analytics")
    ]);
    setSupported(supportedResult);
    setAnalytics(analyticsResult);
  }

  useEffect(() => {
    void refresh().catch((error) => setStatus(error instanceof Error ? error.message : "Playground unavailable"));
  }, []);

  async function runSampleVerify() {
    setStatus("Sending sample verification request...");
    try {
      const result = await apiPost("/x402/verify", sampleBody);
      setVerifyResult(result);
      setStatus("Verification response received.");
      await refresh();
    } catch (error) {
      setVerifyResult({error: error instanceof Error ? error.message : "Verification failed"});
      setStatus("Sample verification returned an expected validation response.");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="x402 playground"
        title="Test Nexora facilitator flows"
        description="Inspect supported x402 configuration, test verification payloads, and monitor SDK facilitator usage."
        action={<button className="secondary-button" onClick={() => navigateTo("/docs/api")}>API docs</button>}
      />

      {status ? <p className="rounded-xl border border-white/[0.1] bg-white/[0.04] p-4 text-sm text-slate-300">{status}</p> : null}

      <section className="grid gap-4 md:grid-cols-4">
        <Metric icon={<RadioTower size={18} />} label="Verifications" value={analytics?.summary.verifications ?? 0} />
        <Metric icon={<CheckCircle2 size={18} />} label="Settlements" value={analytics?.summary.settlements ?? 0} />
        <Metric icon={<XCircle size={18} />} label="Failed" value={analytics?.summary.failed ?? 0} />
        <Metric icon={<Activity size={18} />} label="Volume" value={`$${(analytics?.summary.volumeUsdc ?? 0).toFixed(2)}`} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Verify endpoint</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Sample request</h2>
            </div>
            <button className="action-button" onClick={() => void runSampleVerify()}><Play size={16} /> Run sample</button>
          </div>
          <CodeBlock code={JSON.stringify(sampleBody, null, 2)} />
        </div>

        <div className="panel">
          <p className="section-kicker">Supported config</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Facilitator response</h2>
          <CodeBlock code={JSON.stringify(supported ?? {}, null, 2)} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <p className="section-kicker">Latest verify result</p>
          <CodeBlock code={JSON.stringify(verifyResult ?? {message: "Run the sample to see a response."}, null, 2)} />
        </div>

        <div className="panel">
          <p className="section-kicker">Recent facilitator events</p>
          <div className="mt-5 grid gap-2">
            {(analytics?.recentEvents ?? []).slice(0, 8).map((event) => (
              <div key={event.id} className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-white">{event.kind} · {event.status}</p>
                  <p className="mt-1 text-slate-500">{event.reason ?? `${event.amountUsdc ?? 0} USDC`}</p>
                </div>
                <span className={event.status === "success" ? "status-pill border-mint/25 bg-mint/10 text-mint" : "status-pill border-magenta/25 bg-magenta/10 text-magenta"}>
                  {event.status}
                </span>
              </div>
            ))}
            {(analytics?.recentEvents.length ?? 0) === 0 ? <p className="text-sm text-slate-400">No facilitator events yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({icon, label, value}: {icon: React.ReactNode; label: string; value: string | number}) {
  return (
    <div className="panel">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">{icon}</div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function CodeBlock({code}: {code: string}) {
  return (
    <pre className="mt-5 max-h-[520px] overflow-auto rounded-xl border border-white/[0.1] bg-[#050813] p-4 text-[13px] leading-6 text-slate-200"><code>{code}</code></pre>
  );
}

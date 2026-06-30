import {useEffect, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion} from "framer-motion";
import {Bot, CheckCircle2, Clipboard, Code2, Loader2, Play, Send, Sparkles, Wand2, X} from "lucide-react";
import toast from "react-hot-toast";
import {useAccount} from "wagmi";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {apiPost, type AppSnapshot} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {writeAgentPolicy} from "@/lib/contracts";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Agent = AppSnapshot["agents"][number];
type Service = AppSnapshot["services"][number];

type CommandPlan = {
  agentId: string;
  agentLabel: string;
  policy: {
    dailyLimitUsdc: number;
    transactionCapUsdc: number;
    weeklyLimitUsdc: number;
    monthlyLimitUsdc: number;
    maxUnitsPerRequest: number;
    cooldownSeconds: number;
    expiresAt: string | null;
    requireOnchainPolicy: boolean;
    contractAllowlist: string[];
    recipientAllowlist: string[];
    serviceAllowlist: string[];
  };
  automations: Array<{
    templateId: string;
    name: string;
    params: Record<string, number>;
    agentScoped: boolean;
  }>;
  warnings: string[];
};

type AgentCommandModalProps = {
  open: boolean;
  selectedAgentId?: string;
  onClose: () => void;
  onSelectAgent?: (id: string) => void;
};

const PROMPT_TEMPLATES = [
  {
    id: "research-agent-week",
    title: "One-week research policy",
    copy: `Update my Research Agent policy for 1 week.

Set transaction cap to 10 USDC.
Set daily limit to 30 USDC.
Set weekly limit to 100 USDC.
Allow only GitHub Repo Analyzer and Website Growth Analyzer.
Enable automation to notify me when daily spend reaches 80%.
Pause the agent after it reaches the daily limit.
Send weekly summaries to Telegram.
Expire this policy in 7 days.`
  },
  {
    id: "low-risk-builder",
    title: "Low-risk builder agent",
    copy: `Configure my Builder Agent with a 5 USDC transaction cap, 20 USDC daily limit, and 75 USDC weekly limit.

Allow x402 Integration Planner, Contract Safety Check, and Agent Policy Risk Review.
Notify me on repeated failed payments.
Notify me when policy expires within 3 days.
Set a 30 minute cooldown between requests.
Expire the policy in 14 days.`
  },
  {
    id: "demo-agent",
    title: "Office-hours demo agent",
    copy: `Set my demo agent policy to 50 USDC daily limit and 10 USDC transaction cap.

Allow GitHub Repo Analyzer, Website Growth Analyzer, and Grant Application Reviewer.
Notify me when daily spend reaches 80%.
Create a large receipt alert for payments above 25 USDC.
Send a weekly agent summary.
Expire this policy in 7 days.`
  }
];

const AUTOMATION_DEFINITIONS = {
  dailyWarning: {templateId: "daily-spend-warning", name: "Daily spend guard"},
  dailyPause: {templateId: "daily-spend-pause", name: "Pause agent after daily limit"},
  failedPayments: {templateId: "failed-payment-burst", name: "Repeated failed payments"},
  policyExpiry: {templateId: "policy-expiry", name: "Policy expiry reminder"},
  largeReceipt: {templateId: "large-receipt", name: "Large receipt alert"},
  weeklySummary: {templateId: "weekly-summary", name: "Weekly agent summary"}
} as const;

export function AgentCommandModal({open, selectedAgentId, onClose, onSelectAgent}: AgentCommandModalProps) {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const services = snapshot.data?.services ?? [];
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState(PROMPT_TEMPLATES[0].copy);
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [executing, setExecuting] = useState(false);
  const firstAgentId = agents[0]?.id ?? "";
  const effectiveAgentId = selectedAgentId || agentId || firstAgentId;
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === effectiveAgentId), [agents, effectiveAgentId]);
  const selectedPlanAgent = plan ? agents.find((agent) => agent.id === plan.agentId) : null;

  useEffect(() => {
    if (!open) return;
    const next = selectedAgentId || firstAgentId;
    if (next) setAgentId(next);
    setPlan(null);
  }, [open, selectedAgentId, firstAgentId]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function selectAgent(id: string) {
    setAgentId(id);
    onSelectAgent?.(id);
    setPlan(null);
  }

  function buildPlan() {
    if (!selectedAgent) {
      toast.error("Create an agent wallet before building a command plan.");
      return;
    }
    const parsed = parseCommand(prompt, selectedAgent, services);
    setPlan(parsed);
    toast.success("Command parsed. Review the plan before confirming.");
  }

  async function copyTemplate(copy: string) {
    await navigator.clipboard.writeText(copy);
    toast.success("Prompt template copied.");
  }

  async function confirmPlan(mode: "offchain" | "onchain") {
    if (!plan || !address) return;
    const agent = agents.find((item) => item.id === plan.agentId);
    if (!agent) {
      toast.error("Selected agent was not found.");
      return;
    }
    if (mode === "onchain" && !agent.address) {
      toast.error("This agent does not have an on-chain wallet yet.");
      return;
    }

    setExecuting(true);
    const toastId = toast.loading(mode === "onchain" ? "Writing policy on-chain..." : "Saving command plan...");
    try {
      const policyV2 = {
        weeklyLimitUsdc: plan.policy.weeklyLimitUsdc,
        monthlyLimitUsdc: plan.policy.monthlyLimitUsdc,
        maxUnitsPerRequest: plan.policy.maxUnitsPerRequest,
        cooldownSeconds: plan.policy.cooldownSeconds,
        expiresAt: plan.policy.expiresAt,
        serviceAllowlist: plan.policy.serviceAllowlist,
        previousServiceAllowlist: agent.policy.v2?.serviceAllowlist ?? [],
        requireOnchainPolicy: plan.policy.requireOnchainPolicy || mode === "onchain"
      };
      const txHash = mode === "onchain" && agent.address
        ? await writeAgentPolicy({
            agentWallet: agent.address,
            operatorAddress: agent.operatorAddress,
            arcName: agent.arcName,
            dailyLimitUsdc: String(plan.policy.dailyLimitUsdc),
            transactionCapUsdc: String(plan.policy.transactionCapUsdc),
            contractAllowlist: plan.policy.contractAllowlist,
            recipientAllowlist: plan.policy.recipientAllowlist,
            policyV2: {...policyV2, writeServiceAllowlist: false},
            active: true
          })
        : null;

      await apiPost(`/api/agents/${agent.id}/policies`, {
        operatorAddress: address,
        dailyLimitUsdc: plan.policy.dailyLimitUsdc,
        transactionCapUsdc: plan.policy.transactionCapUsdc,
        contractAllowlist: plan.policy.contractAllowlist,
        recipientAllowlist: plan.policy.recipientAllowlist,
        policyV2,
        txHash
      });

      for (const automation of plan.automations) {
        await apiPost("/api/automation/recipes", {
          operatorAddress: address,
          agentId: automation.agentScoped ? agent.id : null,
          templateId: automation.templateId,
          params: automation.params
        });
      }

      onSelectAgent?.(agent.id);
      await snapshot.refetch();
      toast.success(txHash ? "Policy saved on-chain. Service allowlist saved in Nexora without extra signatures." : "Command plan saved.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Command execution failed", {id: toastId});
    } finally {
      setExecuting(false);
    }
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden px-3 py-4 sm:px-5">
          <motion.button
            type="button"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close command agent"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.18}}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-command-title"
            className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] shadow-[0_30px_90px_rgba(0,0,0,0.62)] 2xl:max-w-[88rem]"
            initial={{opacity: 0, y: 18, scale: 0.98}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: 18, scale: 0.98}}
            transition={{duration: 0.2, ease: [0.22, 1, 0.36, 1]}}
          >
            <div className="shrink-0 border-b border-white/[0.08] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="section-kicker">Agent command</p>
                <h2 id="agent-command-title" className="mt-2 text-2xl font-semibold text-white">Command agent</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Prepare policy and automation changes from a prompt, then review before saving.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="action-button" onClick={buildPlan} disabled={!isConnected || agents.length === 0}>
                  <Wand2 size={16} />
                  Parse
                </button>
                <button type="button" className="secondary-button min-h-10 px-3 py-2" onClick={onClose} aria-label="Close command agent">
                  <X size={16} />
                </button>
              </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-hide sm:p-6">
              {!isConnected ? (
                <EmptyState icon={<Bot size={26} />} title="Connect your wallet" copy="Connect an operator wallet to prepare and confirm agent command plans." />
              ) : agents.length === 0 ? (
                <EmptyState icon={<Bot size={26} />} title="Create an agent first" copy="Create an agent wallet to target policy and automation changes." />
              ) : (
                <section className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-5">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="section-kicker">Prompt templates</p>
                          <h3 className="mt-2 text-xl font-semibold text-white">Copy, edit, then parse</h3>
                        </div>
                        <select className="field max-w-xs bg-slate-950 text-white" value={selectedAgent?.id ?? ""} onChange={(event) => selectAgent(event.target.value)}>
                          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agentLabel(agent)}</option>)}
                        </select>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-3">
                        {PROMPT_TEMPLATES.map((template) => (
                          <button key={template.id} type="button" onClick={() => setPrompt(template.copy)} className="surface p-4 text-left transition hover:border-mint/30">
                            <Sparkles size={18} className="text-orchid" />
                            <p className="mt-3 font-semibold text-white">{template.title}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-400">{template.copy.split("\n").find(Boolean)}</p>
                            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-mint">
                              <Clipboard size={13} />
                              Use template
                            </span>
                          </button>
                        ))}
                      </div>

                      <label className="mt-5 block">
                        <span className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-300">
                          Command prompt
                          <button type="button" className="text-xs font-bold text-mint transition hover:text-white" onClick={() => void copyTemplate(prompt)}>Copy</button>
                        </span>
                        <textarea className="field min-h-52 w-full resize-y leading-6" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                      </label>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button type="button" className="action-button" onClick={buildPlan}>
                          <Wand2 size={16} />
                          Parse and preview
                        </button>
                        <button type="button" className="secondary-button" onClick={() => setPrompt(PROMPT_TEMPLATES[0].copy)}>
                          Reset
                        </button>
                      </div>
                    </div>

                    {plan ? <PlanPreview plan={plan} agent={selectedPlanAgent} /> : null}
                  </div>

                  <aside className="space-y-5">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className="flex items-center gap-3">
                        {selectedAgent ? <AgentAvatar seed={selectedAgent.address ?? selectedAgent.id} label={selectedAgent.arcName ?? selectedAgent.address} size={42} /> : null}
                        <div>
                          <p className="text-base font-semibold text-white">{selectedAgent ? agentLabel(selectedAgent) : "No agent"}</p>
                          <p className="font-mono text-xs text-slate-500">{selectedAgent?.address ? shortAddress(selectedAgent.address) : "Circle pending"}</p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm">
                        <Info label="Current daily" value={`${selectedAgent?.policy.dailyLimitUsdc ?? 0} USDC`} />
                        <Info label="Current tx cap" value={`${selectedAgent?.policy.transactionCapUsdc ?? 0} USDC`} />
                        <Info label="Policy status" value={selectedAgent?.policy.active ? "Active" : "Paused"} />
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className="flex items-center gap-2 text-base font-semibold text-white">
                        <Code2 size={18} className="text-mint" />
                        Execution model
                      </div>
                      <div className="mt-4 grid gap-2 text-sm">
                        {["Prompt is parsed locally into structured actions", "Nexora shows old to new policy changes", "Automation recipes are listed before creation", "On-chain save is capped to base policy plus V2 policy signatures"].map((item) => (
                          <div key={item} className="surface flex items-center gap-2 px-3 py-2 text-slate-300">
                            <CheckCircle2 size={14} className="text-mint" />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    {plan ? (
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <p className="section-kicker">Confirm</p>
                        <div className="mt-4 grid gap-3">
                          <button type="button" className="secondary-button w-full justify-center" onClick={() => void confirmPlan("offchain")} disabled={executing || !address}>
                            {executing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            Save off-chain
                          </button>
                          <button type="button" className="action-button w-full justify-center" onClick={() => void confirmPlan("onchain")} disabled={executing || !address || !selectedPlanAgent?.address}>
                            {executing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                            Save policy on-chain (2 signatures max)
                          </button>
                          {plan.policy.serviceAllowlist.length > 0 ? <p className="text-xs leading-5 text-slate-500">Service allowlist will be saved in Nexora policy data. Per-service on-chain allowlist writes are skipped here to avoid repeated wallet prompts.</p> : null}
                          {!selectedPlanAgent?.address ? <p className="text-xs leading-5 text-amber">On-chain write needs an activated agent wallet address.</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </aside>
                </section>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function PlanPreview({plan, agent}: {plan: CommandPlan; agent: Agent | null | undefined}) {
  const current = agent?.policy;
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-kicker">Structured preview</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{plan.agentLabel}</h3>
        </div>
        <span className="status-pill border-mint/25 bg-mint/10 text-mint">2 on-chain signatures max</span>
      </div>

      {plan.warnings.length > 0 ? (
        <div className="mb-4 grid gap-2">
          {plan.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber/25 bg-amber/10 px-3 py-2 text-sm text-amber">{warning}</p>)}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <DiffRow label="Daily limit" before={`${current?.dailyLimitUsdc ?? 0} USDC`} after={`${plan.policy.dailyLimitUsdc} USDC`} />
        <DiffRow label="Transaction cap" before={`${current?.transactionCapUsdc ?? 0} USDC`} after={`${plan.policy.transactionCapUsdc} USDC`} />
        <DiffRow label="Weekly limit" before={`${current?.v2?.weeklyLimitUsdc ?? 0} USDC`} after={`${plan.policy.weeklyLimitUsdc} USDC`} />
        <DiffRow label="Monthly limit" before={`${current?.v2?.monthlyLimitUsdc ?? 0} USDC`} after={`${plan.policy.monthlyLimitUsdc} USDC`} />
        <DiffRow label="Cooldown" before={formatCooldown(current?.v2?.cooldownSeconds ?? 0)} after={formatCooldown(plan.policy.cooldownSeconds)} />
        <DiffRow label="Expiry" before={current?.v2?.expiresAt ? new Date(current.v2.expiresAt).toLocaleString() : "none"} after={plan.policy.expiresAt ? new Date(plan.policy.expiresAt).toLocaleString() : "none"} />
        <DiffRow label="Service allowlist" before={`${current?.v2?.serviceAllowlist.length ?? 0} services`} after={`${plan.policy.serviceAllowlist.length} services`} />
        <DiffRow label="On-chain required" before={current?.v2?.requireOnchainPolicy ? "yes" : "no"} after={plan.policy.requireOnchainPolicy ? "yes" : "no"} />
      </div>

      {plan.policy.serviceAllowlist.length > 0 ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-white">Allowed services</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.policy.serviceAllowlist.map((service) => <span key={service} className="status-pill">{service}</span>)}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-sm font-semibold text-white">Automation actions</p>
        {plan.automations.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No automation recipes detected in this prompt.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {plan.automations.map((automation) => (
              <div key={automation.templateId} className="surface p-3">
                <p className="font-semibold text-white">{automation.name}</p>
                <p className="mt-1 text-xs text-slate-500">{automation.agentScoped ? "Scoped to this agent" : "All agents"}</p>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-black/20 p-2 text-xs text-slate-300">{JSON.stringify(automation.params, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function parseCommand(prompt: string, agent: Agent, services: Service[]): CommandPlan {
  const text = prompt.toLowerCase();
  const daily = amountNear(text, ["daily limit", "daily spend", "per day"]) ?? agent.policy.dailyLimitUsdc;
  const txCap = amountNear(text, ["transaction cap", "tx cap", "per transaction"]) ?? agent.policy.transactionCapUsdc;
  const weekly = amountNear(text, ["weekly limit", "per week"]) ?? agent.policy.v2?.weeklyLimitUsdc ?? 0;
  const monthly = amountNear(text, ["monthly limit", "per month"]) ?? agent.policy.v2?.monthlyLimitUsdc ?? 0;
  const cooldownSeconds = durationToSeconds(text.match(/(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)\s+cooldown/)?.[0]) ?? agent.policy.v2?.cooldownSeconds ?? 0;
  const expiresAt = expiryFromText(text) ?? agent.policy.v2?.expiresAt ?? null;
  const serviceAllowlist = servicesFromText(text, services, agent.policy.v2?.serviceAllowlist ?? []);
  const requireOnchainPolicy = /\bon-?chain|required onchain|require onchain/.test(text) || Boolean(agent.policy.v2?.requireOnchainPolicy);
  const automations = automationsFromText(text);
  const warnings: string[] = [];
  if (txCap > daily && daily > 0) warnings.push("Transaction cap is higher than the daily limit.");
  if (weekly > 0 && daily > weekly) warnings.push("Daily limit is higher than weekly limit.");
  if (serviceAllowlist.length === 0 && /allow only|service allowlist|allow /.test(text)) warnings.push("The prompt mentions service restrictions, but no matching marketplace services were found.");

  return {
    agentId: agent.id,
    agentLabel: agentLabel(agent),
    policy: {
      dailyLimitUsdc: daily,
      transactionCapUsdc: txCap,
      weeklyLimitUsdc: weekly,
      monthlyLimitUsdc: monthly,
      maxUnitsPerRequest: amountNear(text, ["max units", "units per request"]) ?? agent.policy.v2?.maxUnitsPerRequest ?? 0,
      cooldownSeconds,
      expiresAt,
      requireOnchainPolicy,
      contractAllowlist: agent.policy.contractAllowlist,
      recipientAllowlist: agent.policy.recipientAllowlist,
      serviceAllowlist
    },
    automations,
    warnings
  };
}

function automationsFromText(text: string): CommandPlan["automations"] {
  const automations: CommandPlan["automations"] = [];
  const threshold = percentNear(text, ["daily spend", "daily limit", "threshold"]) ?? 80;
  if (/notify.*daily|daily spend reaches|daily.*threshold|spend guard/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.dailyWarning.templateId, name: AUTOMATION_DEFINITIONS.dailyWarning.name, params: {thresholdPercent: threshold, cooldownHours: 12}, agentScoped: false});
  }
  if (/pause.*daily|pause.*limit|after.*daily limit|require review/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.dailyPause.templateId, name: AUTOMATION_DEFINITIONS.dailyPause.name, params: {thresholdPercent: 100, cooldownHours: 24}, agentScoped: true});
  }
  if (/failed payment|blocked payment|repeated failed/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.failedPayments.templateId, name: AUTOMATION_DEFINITIONS.failedPayments.name, params: {failureCount: 2, windowHours: 24, cooldownHours: 6}, agentScoped: false});
  }
  if (/policy expir|expires within|expiry/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.policyExpiry.templateId, name: AUTOMATION_DEFINITIONS.policyExpiry.name, params: {expiresWithinHours: 72, cooldownHours: 24}, agentScoped: false});
  }
  const largeAmount = amountNear(text, ["above", "over", "large receipt"]) ?? 25;
  if (/large receipt|payments above|receipt.*above|receipt.*over/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.largeReceipt.templateId, name: AUTOMATION_DEFINITIONS.largeReceipt.name, params: {minAmountUsdc: largeAmount, windowHours: 24, cooldownHours: 6}, agentScoped: false});
  }
  if (/weekly summar|summary/.test(text)) {
    automations.push({templateId: AUTOMATION_DEFINITIONS.weeklySummary.templateId, name: AUTOMATION_DEFINITIONS.weeklySummary.name, params: {cooldownHours: 168}, agentScoped: false});
  }
  return dedupeAutomations(automations);
}

function servicesFromText(text: string, services: Service[], fallback: string[]) {
  const matches = services.filter((service) => {
    const candidates = [service.name, service.endpointHash, String(service.chainServiceId ?? ""), service.id].filter(Boolean).map((item) => item.toLowerCase());
    return candidates.some((candidate) => candidate.length > 1 && text.includes(candidate));
  });
  if (matches.length === 0) return fallback;
  return matches.map((service) => service.chainServiceId ? String(service.chainServiceId) : service.id);
}

function amountNear(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const after = text.match(new RegExp(`${escaped}[^\\d$]{0,40}\\$?([0-9]+(?:\\.[0-9]+)?)`));
    if (after) return Number(after[1]);
    const before = text.match(new RegExp(`\\$?([0-9]+(?:\\.[0-9]+)?)[^\\n.]{0,40}${escaped}`));
    if (before) return Number(before[1]);
  }
  return null;
}

function percentNear(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}[^\\d%]{0,60}([0-9]+)\\s*%`)) ?? text.match(new RegExp(`([0-9]+)\\s*%[^\\n.]{0,60}${escaped}`));
    if (match) return Number(match[1]);
  }
  return null;
}

function expiryFromText(text: string) {
  const match = text.match(/(?:expire|expiry|for|in)\s+(?:this policy\s+)?(?:in\s+)?(\d+)\s*(day|days|week|weeks|month|months)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const date = new Date();
  if (unit.startsWith("day")) date.setDate(date.getDate() + amount);
  if (unit.startsWith("week")) date.setDate(date.getDate() + amount * 7);
  if (unit.startsWith("month")) date.setMonth(date.getMonth() + amount);
  return date.toISOString();
}

function durationToSeconds(value?: string) {
  if (!value) return null;
  const match = value.match(/(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("min")) return amount * 60;
  if (unit.startsWith("hour") || unit.startsWith("hr")) return amount * 3600;
  if (unit.startsWith("day")) return amount * 86400;
  return null;
}

function dedupeAutomations(items: CommandPlan["automations"]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.templateId)) return false;
    seen.add(item.templateId);
    return true;
  });
}

function DiffRow({label, before, after}: {label: string; before: string; after: string}) {
  const changed = before !== after;
  return (
    <div className={`surface p-3 ${changed ? "border-mint/20 bg-mint/[0.06]" : ""}`}>
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-400">{before}</p>
      <p className={changed ? "mt-1 font-semibold text-mint" : "mt-1 font-semibold text-white"}>{after}</p>
    </div>
  );
}

function Info({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function agentLabel(agent: Agent) {
  return agent.arcName || agent.address && shortAddress(agent.address) || shortAddress(agent.operatorAddress);
}

function formatCooldown(seconds: number) {
  if (!seconds) return "none";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

import {useEffect, useMemo, useState} from "react";
import {Activity, AlertTriangle, BellRing, Bot, CheckCircle2, Clock, Loader2, PauseCircle, Play, Plus, ShieldCheck, SlidersHorizontal, Sparkles, Workflow} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {AgentAvatar} from "@/components/AgentAvatar";
import {PlanSubscriptionCard} from "@/components/PlanSubscriptionCard";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Snapshot = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>;
type Recipe = Snapshot["automationRecipes"][number];
type Agent = Snapshot["agents"][number];
type Template = {
  id: string;
  name: string;
  description: string;
  trigger: Recipe["trigger"];
  action: Recipe["action"];
  params: Recipe["params"];
};

const TEMPLATES: Template[] = [
  {
    id: "daily-spend-warning",
    name: "Daily spend guard",
    description: "Notify when an agent uses most of its daily budget.",
    trigger: "daily_spend_threshold",
    action: "notify",
    params: {thresholdPercent: 80, cooldownHours: 12}
  },
  {
    id: "daily-spend-pause",
    name: "Pause at daily limit",
    description: "Pause the agent policy when spend reaches the selected daily threshold.",
    trigger: "daily_spend_threshold",
    action: "pause_agent",
    params: {thresholdPercent: 100, cooldownHours: 24}
  },
  {
    id: "failed-payment-burst",
    name: "Repeated failed payments",
    description: "Notify when an agent has repeated failed or policy-blocked payments.",
    trigger: "failed_payment_burst",
    action: "notify",
    params: {failureCount: 2, windowHours: 24, cooldownHours: 6}
  },
  {
    id: "approval-expiring",
    name: "Approval window reminder",
    description: "Notify when pending manual approvals are close to expiry.",
    trigger: "pending_approval_expiring",
    action: "notify",
    params: {expiresWithinHours: 2, cooldownHours: 2}
  },
  {
    id: "policy-expiry",
    name: "Policy expiry reminder",
    description: "Notify before a policy V2 expiry timestamp is reached.",
    trigger: "policy_expiring",
    action: "notify",
    params: {expiresWithinHours: 72, cooldownHours: 24}
  },
  {
    id: "large-receipt",
    name: "Large receipt alert",
    description: "Notify when a settled x402 receipt is above the selected amount.",
    trigger: "large_receipt",
    action: "notify",
    params: {minAmountUsdc: 25, windowHours: 24, cooldownHours: 6}
  },
  {
    id: "weekly-summary",
    name: "Weekly agent summary",
    description: "Send a periodic summary of agent spend, failures, and pending approvals.",
    trigger: "weekly_summary",
    action: "notify",
    params: {cooldownHours: 168}
  }
];

export default function AutomationPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const recipes = snapshot.data?.automationRecipes ?? [];
  const runs = snapshot.data?.automationRuns ?? [];
  const activeRecipes = recipes.filter((recipe) => recipe.active);
  const matchedRuns = runs.filter((run) => run.status === "matched");
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [agentId, setAgentId] = useState("all");
  const [params, setParams] = useState<Recipe["params"]>(TEMPLATES[0].params);
  const [creating, setCreating] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const selectedTemplate = TEMPLATES.find((template) => template.id === templateId) ?? TEMPLATES[0];
  const pauseRequiresAgent = selectedTemplate.action === "pause_agent";
  const canCreate = isConnected && agents.length > 0 && creating === false && (!pauseRequiresAgent || agentId !== "all");

  useEffect(() => {
    setParams(selectedTemplate.params);
  }, [selectedTemplate]);

  useEffect(() => {
    if (pauseRequiresAgent && agentId === "all" && agents[0]) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId, pauseRequiresAgent]);

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId) ?? null, [agents, agentId]);

  async function createRecipe() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before creating automation recipes.");
      return;
    }
    setCreating(true);
    const toastId = toast.loading("Creating automation recipe...");
    try {
      await apiPost("/api/automation/recipes", {
        operatorAddress: address,
        agentId: agentId === "all" ? null : agentId,
        templateId,
        params
      });
      await snapshot.refetch();
      toast.success("Automation recipe created.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create recipe", {id: toastId});
    } finally {
      setCreating(false);
    }
  }

  async function runEvaluation() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before running automation checks.");
      return;
    }
    setEvaluating(true);
    const toastId = toast.loading("Running automation checks...");
    try {
      const result = await apiPost<{runs: Snapshot["automationRuns"]}>("/api/automation/evaluate", {operatorAddress: address});
      await snapshot.refetch();
      const matched = result.runs.filter((run) => run.status === "matched").length;
      toast.success(matched > 0 ? `${matched} automation action${matched === 1 ? "" : "s"} fired.` : "No recipes matched right now.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Automation run failed", {id: toastId});
    } finally {
      setEvaluating(false);
    }
  }

  async function toggleRecipe(recipe: Recipe) {
    if (!address) return;
    const toastId = toast.loading(recipe.active ? "Pausing recipe..." : "Activating recipe...");
    try {
      await apiPost(`/api/automation/recipes/${encodeURIComponent(recipe.id)}`, {
        operatorAddress: address,
        active: !recipe.active
      });
      await snapshot.refetch();
      toast.success(recipe.active ? "Recipe paused." : "Recipe activated.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update recipe", {id: toastId});
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Agent automation"
        title="Automation recipes"
        description="Create agent-side rules that watch spend, failures, approvals, policy expiry, and receipts, then notify you or pause risky agents."
        action={
          <button type="button" onClick={runEvaluation} className="action-button" disabled={!isConnected || evaluating || recipes.length === 0}>
            {evaluating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Run checks
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={Workflow} label="Recipes" value={recipes.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={CheckCircle2} label="Active" value={activeRecipes.length} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Activity} label="Actions fired" value={matchedRuns.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Bot} label="Managed agents" value={agents.length} loading={snapshot.isLoading} />
      </div>

      <PlanSubscriptionCard
        planId="premium_agent_automation"
        subscriptions={snapshot.data?.subscriptions ?? []}
        onActivated={async () => {
          await snapshot.refetch();
        }}
      />

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="panel">
          <div className="mb-5">
            <p className="section-kicker">Create recipe</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Choose an automation template</h2>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {TEMPLATES.map((template) => {
              const selected = template.id === templateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setTemplateId(template.id)}
                  className={`surface p-4 text-left transition ${selected ? "border-mint/35 bg-mint/10" : "hover:border-plasma/30"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${selected ? "border-mint/30 bg-mint/10 text-mint" : "border-white/[0.1] bg-white/[0.04] text-orchid"}`}>
                      <TemplateIcon trigger={template.trigger} action={template.action} />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{template.name}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{template.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="status-pill">{formatTrigger(template.trigger)}</span>
                        <span className={`status-pill ${template.action === "pause_agent" ? "border-amber/25 bg-amber/10 text-amber" : ""}`}>{formatAction(template.action)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Agent scope
              <select className="field bg-slate-950 text-white" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="all" disabled={pauseRequiresAgent}>All agents</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agentLabel(agent)}</option>)}
              </select>
              {pauseRequiresAgent ? <span className="text-xs leading-5 text-amber">Pause recipes must be scoped to one agent.</span> : null}
            </label>

            <div className="surface p-4">
              <div className="flex items-center gap-3">
                {selectedAgent ? <AgentAvatar seed={selectedAgent.address ?? selectedAgent.id} label={selectedAgent.arcName ?? selectedAgent.address} size={36} /> : <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-orchid"><Bot size={17} /></div>}
                <div>
                  <p className="text-sm font-semibold text-white">{selectedAgent ? agentLabel(selectedAgent) : "All active agents"}</p>
                  <p className="text-xs text-slate-500">{selectedAgent?.address ? shortAddress(selectedAgent.address) : "Recipe evaluates every managed agent"}</p>
                </div>
              </div>
            </div>
          </div>

          <RecipeParams trigger={selectedTemplate.trigger} params={params} onChange={setParams} />

          <button type="button" onClick={createRecipe} className="action-button mt-5 w-full" disabled={!canCreate}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {agents.length === 0 ? "Create an agent first" : pauseRequiresAgent && agentId === "all" ? "Select an agent" : creating ? "Creating..." : "Create automation recipe"}
          </button>
        </div>

        <aside className="space-y-5">
          <div className="panel">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <Sparkles size={18} className="text-mint" />
              What recipes can do
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              {["Notify through enabled channels", "Pause a risky agent policy", "Watch approvals before expiry", "Summarize weekly agent activity"].map((item) => (
                <div key={item} className="surface flex items-center gap-2 px-4 py-3 text-slate-300">
                  <CheckCircle2 size={15} className="text-mint" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <p className="section-kicker">Recent runs</p>
            <div className="mt-4 grid gap-3">
              {runs.length === 0 ? (
                <p className="text-sm leading-6 text-slate-400">No automation runs yet. Create a recipe and run checks to see results.</p>
              ) : (
                runs.slice(0, 6).map((run) => <RunRow key={run.id} run={run} />)
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-kicker">Active logic</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Recipe inventory</h2>
          </div>
          <span className="status-pill">{activeRecipes.length} active</span>
        </div>

        {snapshot.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[0, 1].map((item) => <div key={item} className="shimmer h-36 rounded-xl" />)}
          </div>
        ) : recipes.length === 0 ? (
          <EmptyState
            icon={<Workflow size={26} />}
            title="No automation recipes yet"
            copy="Create a recipe to start monitoring agent spend, approvals, policy expiry, receipts, and failed payments."
            className="border-0 bg-transparent p-0 py-8 shadow-none"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} agents={agents} onToggle={() => void toggleRecipe(recipe)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function RecipeParams({trigger, params, onChange}: {trigger: Recipe["trigger"]; params: Recipe["params"]; onChange: (params: Recipe["params"]) => void}) {
  function setParam(key: keyof Recipe["params"], value: string) {
    onChange({...params, [key]: value === "" ? undefined : Number(value)});
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-3">
      {trigger === "daily_spend_threshold" ? (
        <>
          <NumberField label="Threshold percent" value={params.thresholdPercent ?? ""} suffix="%" onChange={(value) => setParam("thresholdPercent", value)} />
          <NumberField label="Threshold USDC" value={params.thresholdUsdc ?? ""} suffix="USDC" onChange={(value) => setParam("thresholdUsdc", value)} />
        </>
      ) : null}
      {trigger === "failed_payment_burst" ? (
        <>
          <NumberField label="Failures" value={params.failureCount ?? ""} onChange={(value) => setParam("failureCount", value)} />
          <NumberField label="Window" value={params.windowHours ?? ""} suffix="hours" onChange={(value) => setParam("windowHours", value)} />
        </>
      ) : null}
      {trigger === "pending_approval_expiring" || trigger === "policy_expiring" ? (
        <NumberField label="Expires within" value={params.expiresWithinHours ?? ""} suffix="hours" onChange={(value) => setParam("expiresWithinHours", value)} />
      ) : null}
      {trigger === "large_receipt" ? (
        <>
          <NumberField label="Minimum receipt" value={params.minAmountUsdc ?? ""} suffix="USDC" onChange={(value) => setParam("minAmountUsdc", value)} />
          <NumberField label="Window" value={params.windowHours ?? ""} suffix="hours" onChange={(value) => setParam("windowHours", value)} />
        </>
      ) : null}
      <NumberField label="Cooldown" value={params.cooldownHours ?? ""} suffix="hours" onChange={(value) => setParam("cooldownHours", value)} />
    </div>
  );
}

function NumberField({label, value, suffix, onChange}: {label: string; value: string | number; suffix?: string; onChange: (value: string) => void}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-300">
      {label}
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.06] px-3">
        <input className="w-full bg-transparent py-3 text-white outline-none" type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{suffix}</span> : null}
      </div>
    </label>
  );
}

function RecipeCard({recipe, agents, onToggle}: {recipe: Recipe; agents: Agent[]; onToggle: () => void}) {
  const agent = recipe.agentId ? agents.find((item) => item.id === recipe.agentId) : null;
  return (
    <article className="surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${recipe.active ? "border-mint/25 bg-mint/10 text-mint" : "border-white/[0.1] bg-white/[0.04] text-slate-400"}`}>{recipe.active ? "Active" : "Paused"}</span>
            <span className="status-pill">{formatTrigger(recipe.trigger)}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-white">{recipe.name}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">{recipe.description}</p>
        </div>
        <button type="button" onClick={onToggle} className="secondary-button min-h-10 shrink-0 px-3 py-2 text-xs">
          {recipe.active ? <PauseCircle size={14} /> : <Play size={14} />}
          {recipe.active ? "Pause" : "Resume"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Info label="Scope" value={agent ? agentLabel(agent) : "All agents"} />
        <Info label="Action" value={formatAction(recipe.action)} />
        <Info label="Runs" value={String(recipe.runCount)} />
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        {recipe.lastRunReason ? <p className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-slate-300">{recipe.lastRunReason}</p> : null}
        <p className="text-xs text-slate-500">
          Last run: {recipe.lastRunAt ? timeAgo(recipe.lastRunAt) : "never"} · Last action: {recipe.lastTriggeredAt ? timeAgo(recipe.lastTriggeredAt) : "never"}
        </p>
      </div>
    </article>
  );
}

function RunRow({run}: {run: Snapshot["automationRuns"][number]}) {
  const visual = run.status === "matched" ? "text-mint" : run.status === "failed" ? "text-magenta" : "text-amber";
  return (
    <div className="surface p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={`font-semibold capitalize ${visual}`}>{run.status}</span>
        <span className="text-xs text-slate-500">{timeAgo(run.createdAt)}</span>
      </div>
      <p className="mt-2 leading-6 text-slate-300">{run.summary}</p>
      <p className="mt-2 text-xs text-slate-500">{formatTrigger(run.trigger)} · {formatAction(run.action)}</p>
    </div>
  );
}

function Info({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function TemplateIcon({trigger, action}: {trigger: Recipe["trigger"]; action: Recipe["action"]}) {
  if (action === "pause_agent") return <ShieldCheck size={18} />;
  if (trigger === "failed_payment_burst") return <AlertTriangle size={18} />;
  if (trigger === "policy_expiring" || trigger === "pending_approval_expiring") return <Clock size={18} />;
  if (trigger === "large_receipt") return <BellRing size={18} />;
  if (trigger === "weekly_summary") return <SlidersHorizontal size={18} />;
  return <Activity size={18} />;
}

function formatTrigger(trigger: Recipe["trigger"]) {
  return trigger.replaceAll("_", " ");
}

function formatAction(action: Recipe["action"]) {
  if (action === "pause_agent") return "Pause agent";
  return "Notify";
}

function agentLabel(agent: Agent) {
  return agent.arcName ?? (agent.address ? shortAddress(agent.address) : shortAddress(agent.operatorAddress));
}

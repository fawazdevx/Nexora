import {BadgeCheck, BriefcaseBusiness, Landmark, ReceiptText, ShieldCheck, TrendingUp} from "lucide-react";
import {PublishServiceForm} from "@/components/PublishServiceForm";
import {PageHeader} from "@/components/PageHeader";

const highValueCategories = [
  {label: "Risk", icon: ShieldCheck, copy: "Wallet approvals, contract safety, transaction simulation, policy review."},
  {label: "Payments", icon: ReceiptText, copy: "Invoices, payment collection, subscriptions, receipts, payout ops."},
  {label: "Treasury", icon: Landmark, copy: "USDC/EURC routing, balances, cash movement, fee and settlement checks."},
  {label: "Escrow", icon: BriefcaseBusiness, copy: "Milestones, deadline reminders, evidence summaries, dispute risk."},
  {label: "Yield", icon: TrendingUp, copy: "Vault APY monitoring, risk notes, rebalance recommendations."},
  {label: "Compliance", icon: BadgeCheck, copy: "Counterparty screening, sanctions risk, audit exports, approvals."}
];

export default function NewServicePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="panel">
        <PageHeader
          kicker="Marketplace categories"
          title="Publish services agents can justify paying for"
          description="The strongest services save money, reduce risk, collect payments, unlock data, or help an organization operate USDC workflows safely."
        />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {highValueCategories.map((category) => {
            const Icon = category.icon;
            return (
              <div key={category.label} className="surface p-4">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Icon size={17} className="text-mint" />
                  {category.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{category.copy}</p>
              </div>
            );
          })}
        </div>
      </section>
      <div className="panel">
        <PageHeader
          kicker="Developer console"
          title="Publish monetized API"
          description="Set a service manifest, x402 endpoint hash, and per-unit USDC pricing. Use a real external API or SDK-protected endpoint when publishing beyond demos."
        />
        <PublishServiceForm />
      </div>
    </div>
  );
}

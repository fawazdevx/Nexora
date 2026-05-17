import {Activity, ExternalLink, Github, Mail} from "lucide-react";
import {navigateTo} from "@/lib/router";

const links = [
  {label: "Earn", href: "/earn"},
  {label: "Marketplace", href: "/marketplace"},
  {label: "Agents", href: "/agents"},
  {label: "Reputation", href: "/reputation"}
];

const socialLinks = [
  {label: "X", href: import.meta.env.VITE_NEXORA_X_URL || "https://x.com/nexorafi", icon: ExternalLink},
  {label: "GitHub", href: import.meta.env.VITE_NEXORA_GITHUB_URL || "https://github.com", icon: Github},
  {label: "Contact", href: import.meta.env.VITE_NEXORA_CONTACT_URL || "mailto:hello@nexora.finance", icon: Mail}
];

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  if (href.startsWith("http") || href.startsWith("mailto:")) return;
  event.preventDefault();
  navigateTo(href);
}

export function Footer() {
  return (
    <footer className="relative border-t border-white/[0.08] bg-void/85 px-4 py-8 text-slate-300 md:px-6">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-plasma/25 bg-plasma/10 text-orchid">
            <Activity size={20} />
          </div>
          <div>
            <p className="text-xl font-semibold text-white">Nexora</p>
            <p className="mt-1 text-sm text-slate-400">Agent-native USDC payments and earning infrastructure.</p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-3 text-[15px]">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={(event) => navigate(event, link.href)} className="rounded-lg px-3 py-2 transition hover:bg-white/[0.05] hover:text-white">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-wrap gap-2">
          {socialLinks.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                className="secondary-button min-h-11 px-4"
                aria-label={link.label}
              >
                <Icon size={16} />
                {link.label}
              </a>
            );
          })}
        </div>
      </div>

      <div className="mx-auto mt-6 flex max-w-[1440px] flex-wrap justify-between gap-3 border-t border-white/[0.07] pt-5 text-sm text-slate-500">
        <span>© {new Date().getFullYear()} Nexora Finance</span>
        <span>Arc Testnet · USDC · x402 · Agent Wallets</span>
      </div>
    </footer>
  );
}

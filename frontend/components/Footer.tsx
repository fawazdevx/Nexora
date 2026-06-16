import {ArrowRight, Github, Mail} from "lucide-react";
import {navigateTo} from "@/lib/router";

type FooterLink = {label: string; href: string};

const linkGroups: Array<{title: string; links: FooterLink[]}> = [
  {
    title: "Platform",
    links: [
      {label: "Agents", href: "/agents"},
      {label: "Marketplace", href: "/marketplace"},
      {label: "Escrow", href: "/escrow"},
      {label: "Save / Earn", href: "/earn"}
    ]
  },
  {
    title: "Developers",
    links: [
      {label: "API Docs", href: "/docs/api"},
      {label: "x402 Playground", href: "/x402/playground"},
      {label: "Builder Directory", href: "/builders"},
      {label: "Developer Console", href: "/developer"}
    ]
  },
  {
    title: "Resources",
    links: [
      {label: "Revenue Proof", href: "/revenue"},
      {label: "Reputation", href: "/reputation"},
      {label: "Swap", href: "/swap"},
      {label: "Policies", href: "/settings/policies"}
    ]
  }
];

const legalLinks: FooterLink[] = [
  {label: "Privacy", href: "/docs/api"},
  {label: "Terms", href: "/docs/api"}
];

function XGlyph({size = 16}: {size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

const socialLinks = [
  {label: "X", href: import.meta.env.VITE_NEXORA_X_URL || "https://x.com/nexorafi", icon: XGlyph},
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
    <footer className="relative overflow-hidden border-t border-white/[0.1] bg-gradient-to-b from-void/90 to-void/95 px-4 pb-10 pt-12 text-slate-300 backdrop-blur-xl md:px-6">
      {/* Top accent line + ambient glow + oversized wordmark watermark. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-plasma/60 to-transparent" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[40rem] -translate-x-1/2 rounded-full bg-plasma/[0.07] blur-3xl" />
      <img
        src="/nexora-wordmark-footer.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-6 right-0 hidden w-[28rem] max-w-[60%] opacity-[0.04] md:block"
      />

      <div className="relative mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[1.4fr_2fr]">
        <div className="flex flex-col gap-4">
          <img src="/nexora-wordmark-footer.png" alt="Nexora" className="h-7 w-auto self-start" />
          <p className="max-w-xs text-sm font-medium leading-6 text-slate-400">
            Agent-native USDC payments and earning infrastructure, built Arc-first.
          </p>
          <span className="status-pill w-fit border-mint/25 bg-mint/10 text-mint">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            Arc Testnet · Operational
          </span>
          <div className="mt-1 flex gap-2.5">
            {socialLinks.map((link) => {
              const Icon = link.icon;
              const external = link.href.startsWith("http");
              return (
                <a
                  key={link.label}
                  href={link.href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                  aria-label={link.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-slate-300 transition-all duration-200 hover:scale-105 hover:border-plasma/40 hover:bg-white/[0.08] hover:text-white"
                >
                  <Icon size={16} />
                </a>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {linkGroups.map((group) => (
            <nav key={group.title} className="flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{group.title}</p>
              {group.links.map((link) => (
                <a
                  key={`${group.title}-${link.label}`}
                  href={link.href}
                  onClick={(event) => navigate(event, link.href)}
                  className="text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>
      </div>

      <div className="relative mx-auto mt-10 flex max-w-[1440px] flex-col gap-4 border-t border-white/[0.08] pt-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-slate-500">
          <span>© {new Date().getFullYear()} Nexora Finance</span>
          {legalLinks.map((link) => (
            <a key={link.label} href={link.href} onClick={(event) => navigate(event, link.href)} className="transition-colors hover:text-slate-300">
              {link.label}
            </a>
          ))}
          <span className="hidden text-slate-700 sm:inline">·</span>
          <span className="hidden sm:inline">Arc Testnet · USDC · x402 · Agent Wallets</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button min-h-10 px-4 py-2 text-sm">
            Read Docs
          </a>
          <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button min-h-10 px-4 py-2 text-sm">
            Launch App
            <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </footer>
  );
}

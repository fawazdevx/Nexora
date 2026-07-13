import {
  ArrowRightLeft,
  Bell,
  BookOpen,
  Bot,
  Brain,
  BriefcaseBusiness,
  CircleDollarSign,
  Coins,
  Gauge,
  Home,
  KeyRound,
  Landmark,
  Network,
  PlayCircle,
  RadioTower,
  ShieldCheck,
  Store,
  UserCog,
  UsersRound,
  Zap
} from "lucide-react";
import type {LucideIcon} from "lucide-react";

export type NavLeaf = {href: string; label: string; icon: LucideIcon; description: string};
export type NavGroup = {label: string; items: NavLeaf[]};

export const homeItem: NavLeaf = {href: "/home", label: "Home", icon: Home, description: "Control center overview"};

export const navGroups: NavGroup[] = [
  {
    label: "Platform",
    items: [
      {href: "/agents", label: "Agents", icon: Bot, description: "Create and manage agent wallets"},
      {href: "/automation", label: "Automation", icon: PlayCircle, description: "Agent recipes and safety actions"},
      {href: "/memory", label: "Memory", icon: Brain, description: "Memo-backed agent spend context"},
      {href: "/marketplace", label: "Marketplace", icon: Store, description: "Discover and buy paid APIs"},
      {href: "/circle-marketplace", label: "Circle Bridge", icon: CircleDollarSign, description: "Pay Circle x402 services"},
      {href: "/escrow", label: "Escrow", icon: BriefcaseBusiness, description: "USDC work agreements"},
      {href: "/payments", label: "Payments", icon: Coins, description: "Settled payment receipts"}
    ]
  },
  {
    label: "Earn & Trade",
    items: [
      {href: "/earn", label: "Save / Earn", icon: Zap, description: "Route USDC into Arc strategies"},
      {href: "/swap", label: "Swap", icon: ArrowRightLeft, description: "Compare Arc liquidity routes"},
      {href: "/gateway", label: "Gateway", icon: Network, description: "Unified USDC balance"},
      {href: "/revenue", label: "Revenue", icon: Landmark, description: "Treasury fees vs gross volume"}
    ]
  },
  {
    label: "Build",
    items: [
      {href: "/developer", label: "Developer", icon: UserCog, description: "Publisher dashboard"},
      {href: "/docs/api", label: "API Docs", icon: BookOpen, description: "SDK and x402 reference"},
      {href: "/x402/playground", label: "x402 Playground", icon: RadioTower, description: "Test x402 payment flows"},
      {href: "/builders", label: "Builders", icon: UsersRound, description: "Builder directory"}
    ]
  },
  {
    label: "Network",
    items: [
      {href: "/admin/deployments", label: "Deployments", icon: Network, description: "Contract deployment status"},
      {href: "/identity", label: "Identity", icon: KeyRound, description: "Arc name and identity"},
      {href: "/reputation", label: "Reputation", icon: ShieldCheck, description: "Operator reputation signal"},
      {href: "/settings/notifications", label: "Notifications", icon: Bell, description: "Agent alerts and receipts"},
      {href: "/settings/policies", label: "Policies", icon: Gauge, description: "Spending limits and allowlists"}
    ]
  }
];

/** Flat list (Home first) for the command palette and breadcrumb lookups. */
export const allNavItems: NavLeaf[] = [homeItem, ...navGroups.flatMap((group) => group.items)];

export function isNavActive(pathname: string, href: string) {
  if (href === "/home") return pathname === "/home" || pathname === "/app" || pathname === "/";
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

/** Resolve the active group + leaf for a pathname, for breadcrumb context. */
export function findNav(pathname: string): {group: string | null; item: NavLeaf} | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (isNavActive(pathname, item.href)) return {group: group.label, item};
    }
  }
  if (pathname === "/home" || pathname === "/app" || pathname === "/") return {group: null, item: homeItem};
  return null;
}

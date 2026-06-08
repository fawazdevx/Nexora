import {ArrowRightLeft, Bot, BookOpen, BriefcaseBusiness, Coins, Gauge, Home, KeyRound, Landmark, Network, ShieldCheck, Store, UsersRound, UserCog, Zap} from "lucide-react";

export const navItems = [
  {href: "/app", label: "Home", icon: Home},
  {href: "/agents", label: "Agents", icon: Bot},
  {href: "/earn", label: "Earn", icon: Zap},
  {href: "/swap", label: "Swap", icon: ArrowRightLeft},
  {href: "/marketplace", label: "Market", icon: Store},
  {href: "/builders", label: "Builders", icon: UsersRound},
  {href: "/developer", label: "Developer", icon: UserCog},
  {href: "/docs/api", label: "API Docs", icon: BookOpen},
  {href: "/revenue", label: "Revenue", icon: Landmark},
  {href: "/admin/deployments", label: "Deployments", icon: Network},
  {href: "/escrow", label: "Escrow", icon: BriefcaseBusiness},
  {href: "/payments", label: "Payments", icon: Coins},
  {href: "/identity", label: "Identity", icon: KeyRound},
  {href: "/reputation", label: "Reputation", icon: ShieldCheck},
  {href: "/settings/policies", label: "Policies", icon: Gauge}
];

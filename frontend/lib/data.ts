import {Bot, Coins, Gauge, KeyRound, ShieldCheck, Store, Terminal, Zap} from "lucide-react";

export const navItems = [
  {href: "/app", label: "Command", icon: Terminal},
  {href: "/agents", label: "Agents", icon: Bot},
  {href: "/earn", label: "Earn", icon: Zap},
  {href: "/marketplace", label: "Market", icon: Store},
  {href: "/payments", label: "Payments", icon: Coins},
  {href: "/identity", label: "Identity", icon: KeyRound},
  {href: "/reputation", label: "Reputation", icon: ShieldCheck},
  {href: "/settings/policies", label: "Policies", icon: Gauge}
];

import {Bot, Coins, Gauge, Home, KeyRound, ShieldCheck, Store, Zap} from "lucide-react";

export const navItems = [
  {href: "/app", label: "Home", icon: Home},
  {href: "/agents", label: "Agents", icon: Bot},
  {href: "/earn", label: "Earn", icon: Zap},
  {href: "/marketplace", label: "Market", icon: Store},
  {href: "/payments", label: "Payments", icon: Coins},
  {href: "/identity", label: "Identity", icon: KeyRound},
  {href: "/reputation", label: "Reputation", icon: ShieldCheck},
  {href: "/settings/policies", label: "Policies", icon: Gauge}
];

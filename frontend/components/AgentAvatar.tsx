type AgentAvatarProps = {
  seed: string;
  label?: string | null;
  size?: number;
};

// Deterministic hue from a string so each agent gets a stable, distinct gradient.
function hashSeed(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initials(label: string | null | undefined, seed: string) {
  const source = (label ?? "").trim();
  if (source.startsWith("0x")) return source.slice(2, 4).toUpperCase();
  if (source) {
    const parts = source.split(/[\s.\-_]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  return seed.replace(/^0x/, "").slice(0, 2).toUpperCase();
}

/** Deterministic gradient monogram avatar derived from a wallet address / arc name. */
export function AgentAvatar({seed, label, size = 44}: AgentAvatarProps) {
  const hash = hashSeed(seed.toLowerCase());
  const hueA = hash % 360;
  const hueB = (hueA + 48 + (hash % 60)) % 360;
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-xl font-bold text-white shadow-[0_0_18px_rgba(0,0,0,0.35)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(135deg, hsl(${hueA} 70% 55%), hsl(${hueB} 72% 42%))`
      }}
      aria-hidden="true"
    >
      {initials(label, seed)}
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
    </span>
  );
}

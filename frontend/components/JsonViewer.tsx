import {useState} from "react";
import {Check, Copy} from "lucide-react";
import toast from "react-hot-toast";

type Token = {text: string; className: string};

// Lightweight JSON tokenizer for syntax tint — keys, strings, numbers, literals.
function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  const regex = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({text: code.slice(lastIndex, match.index), className: "text-slate-500"});
    }
    if (match[1] && match[2]) {
      tokens.push({text: match[1], className: "text-orchid"});
      tokens.push({text: match[2], className: "text-slate-500"});
    } else if (match[1]) {
      tokens.push({text: match[1], className: "text-mint"});
    } else if (match[3]) {
      tokens.push({text: match[3], className: "text-amber"});
    } else if (match[4]) {
      tokens.push({text: match[4], className: "text-cyan"});
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) {
    tokens.push({text: code.slice(lastIndex), className: "text-slate-500"});
  }
  return tokens;
}

function tokenizeTs(code: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|const|let|var|async|await|return|new|function|class|if|else|for|of|in|true|false|null|undefined)\b|(=>)|\b(\d+(?:\.\d+)?)\b/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) tokens.push({text: code.slice(lastIndex, match.index), className: "text-slate-300"});
    if (match[1]) tokens.push({text: match[1], className: "italic text-slate-600"});
    else if (match[2]) tokens.push({text: match[2], className: "text-mint"});
    else if (match[3]) tokens.push({text: match[3], className: "text-orchid"});
    else if (match[4]) tokens.push({text: match[4], className: "text-orchid"});
    else if (match[5]) tokens.push({text: match[5], className: "text-cyan"});
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) tokens.push({text: code.slice(lastIndex), className: "text-slate-300"});
  return tokens;
}

function tokenizeBash(code: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(curl|npm|npx|yarn|pnpm|cd|export|echo)\b|(\s-{1,2}[A-Za-z][A-Za-z-]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) tokens.push({text: code.slice(lastIndex, match.index), className: "text-slate-300"});
    if (match[1]) tokens.push({text: match[1], className: "italic text-slate-600"});
    else if (match[2]) tokens.push({text: match[2], className: "text-mint"});
    else if (match[3]) tokens.push({text: match[3], className: "text-orchid"});
    else if (match[4]) tokens.push({text: match[4], className: "text-cyan"});
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) tokens.push({text: code.slice(lastIndex), className: "text-slate-300"});
  return tokens;
}

function tokenize(code: string, language: "json" | "ts" | "bash"): Token[] {
  if (language === "ts") return tokenizeTs(code);
  if (language === "bash") return tokenizeBash(code);
  return tokenizeJson(code);
}

export type JsonStatus = {label: string; tone: "ok" | "error" | "muted"; detail?: string};

const STATUS_TONE: Record<JsonStatus["tone"], string> = {
  ok: "border-mint/25 bg-mint/10 text-mint",
  error: "border-magenta/25 bg-magenta/10 text-magenta",
  muted: "border-white/[0.12] bg-white/[0.04] text-slate-400"
};

/** Code/JSON viewer with macOS window chrome, copy button, syntax tint, and an optional status badge. */
export function JsonViewer({
  title,
  code,
  language = "json",
  status,
  maxHeight = "440px"
}: {
  title: string;
  code: string;
  language?: "json" | "ts" | "bash";
  status?: JsonStatus;
  maxHeight?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }

  const tokens = tokenize(code, language);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#050813] shadow-neon">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="truncate text-xs font-medium text-slate-500">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status.tone]}`}>
              {status.label}
              {status.detail ? <span className="font-normal opacity-70">{status.detail}</span> : null}
            </span>
          ) : null}
          <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-plasma/40 hover:text-white">
            {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-auto p-4 text-[13px] leading-6 text-slate-200" style={{maxHeight}}>
        <code>
          {tokens.map((token, index) => <span key={index} className={token.className}>{token.text}</span>)}
        </code>
      </pre>
    </div>
  );
}

/** CLI flags for scripts/dev-verify.ts (spec §5). Pure; no process access. */

export interface ParsedArgs {
  route: string;
  baseUrl?: string;
  screenshot?: string;
  fullPage: boolean;
  text: boolean;
  a11y: boolean;
  console: boolean;
  viewport: { width: number; height: number };
  theme?: "light" | "dark";
  clicks: string[];
  waitFor?: string;
  json: boolean;
}

export type ArgsError = { error: string };

export function isArgsError(v: ParsedArgs | ArgsError): v is ArgsError {
  return typeof (v as ArgsError).error === "string";
}

const BOOLEAN_FLAGS = new Set(["--full-page", "--text", "--a11y", "--console", "--json"]);
const VALUE_FLAGS = new Set(["--route", "--base-url", "--screenshot", "--viewport", "--theme", "--click", "--wait"]);

export function parseArgs(argv: string[]): ParsedArgs | ArgsError {
  const out: ParsedArgs = {
    route: "",
    fullPage: false,
    text: false,
    a11y: false,
    console: false,
    viewport: { width: 1280, height: 800 },
    clicks: [],
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (BOOLEAN_FLAGS.has(flag)) {
      switch (flag) {
        case "--full-page": out.fullPage = true; break;
        case "--text": out.text = true; break;
        case "--a11y": out.a11y = true; break;
        case "--console": out.console = true; break;
        case "--json": out.json = true; break;
      }
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { error: `unknown flag ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value` };
    i += 1;
    switch (flag) {
      case "--route": out.route = value; break;
      case "--base-url": out.baseUrl = value; break;
      case "--screenshot": out.screenshot = value; break;
      case "--wait": out.waitFor = value; break;
      case "--click": out.clicks.push(value); break;
      case "--theme":
        if (value !== "light" && value !== "dark") return { error: "--theme must be light or dark" };
        out.theme = value;
        break;
      case "--viewport": {
        const m = /^(\d{3,5})x(\d{3,5})$/.exec(value);
        if (!m) return { error: "--viewport must be WxH, e.g. 1280x800" };
        out.viewport = { width: Number(m[1]), height: Number(m[2]) };
        break;
      }
    }
  }
  if (!out.route.startsWith("/")) return { error: "--route is required and must start with /" };
  return out;
}

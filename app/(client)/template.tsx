// Exists so page content REMOUNTS on every navigation (a layout persists; a
// template does not), which is what makes the [data-reveal] keyframes replay.
// It renders a fragment on purpose: any wrapper here would sit between <main> and
// the page, and a wrapper with a transform is a containing block for every
// `position: fixed` descendant (guarded by reveal.test.ts). Server component; no
// hooks; no motion import.
export default function ClientTemplate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

"use client";

// The error boundary every dynamically imported admin panel renders inside.
//
// `next/dynamic` in the App Router renders its `loading` component ONLY as a
// Suspense fallback: `lazy-dynamic/loadable.js` passes it `{ isLoading: true,
// pastDelay: true, error: null }` and never an `error` or a `retry`. A rejected
// `import()` therefore throws straight through `React.lazy` to the nearest error
// boundary — `app/(client)/error.tsx` — and one failed chunk takes the whole of
// `/admin` with it. This boundary keeps that failure inside the panel's own
// column, where the rail, the other tabs and the page still work.
//
// «REINTENTAR» RELOADS THE PAGE, and the copy says so. `React.lazy` CACHES the
// rejected promise, so re-rendering the same dynamic component re-throws without
// ever re-running the import: a local retry would be a button that cannot work.
// Rebuilding the `dynamic()` instance per render is the alternative, and it is
// what `react-hooks/static-components` (an eslint ERROR here) forbids — so the
// honest recovery is a fresh document. `onRetry` exists for a caller that can do
// better, and for the test that drives the recovery without navigating.

import React from "react";

import Button from "@/app/components/ui/Button";

export default class PanelBoundary extends React.Component<
  { children: React.ReactNode; onRetry?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="font-body text-sm text-mono-400">No se pudo cargar esta sección.</p>
        <Button
          variant="ghost"
          onClick={() => {
            // Resetting before a reload would re-render the cached rejection and
            // throw again while the navigation is still in flight.
            if (!this.props.onRetry) {
              window.location.reload();
              return;
            }
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          Reintentar
        </Button>
        <p className="font-body text-xs text-mono-500">Se recargará la página.</p>
      </div>
    );
  }
}

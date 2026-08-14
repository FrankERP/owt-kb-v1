"use client";

import { addChart, moveChart, removeChart, updateChart, type ChartDraft } from "@/app/utils/songFormCharts";

export function ChordChartsFields({
  charts,
  onChange,
  inputCls,
  defaultKey = "",
  idPrefix,
}: {
  charts: ChartDraft[];
  onChange: (next: ChartDraft[]) => void;
  inputCls: string;
  defaultKey?: string;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-label text-xs uppercase tracking-widest text-mono-500">Acordes</p>
        <button
          type="button"
          onClick={() => onChange(addChart(charts, defaultKey))}
          className="font-label text-[11px] uppercase tracking-widest text-accent transition-colors hover:text-accent/70"
        >
          + Agregar cifrado
        </button>
      </div>
      {charts.length === 0 ? (
        <p className="font-body text-xs text-mono-600">Sin cifrados todavía. La letra vive arriba; los acordes, aquí.</p>
      ) : (
        <div className="space-y-4">
          {charts.map((chart, i) => {
            const keyId = `${idPrefix}-chart-${chart.id}-key`;
            const contentId = `${idPrefix}-chart-${chart.id}-content`;
            return (
              <div key={chart.id} className="space-y-2 rounded-lg border border-accent/20 p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor={keyId} className="font-label text-xs uppercase tracking-widest text-mono-500">
                      Tonalidad
                    </label>
                    <input
                      id={keyId}
                      className={inputCls}
                      value={chart.key}
                      onChange={(e) => onChange(updateChart(charts, chart.id, { key: e.target.value }))}
                      placeholder="Ej: C, Am"
                    />
                  </div>
                  <div className="flex shrink-0 gap-1 pb-0.5">
                    <button
                      type="button"
                      onClick={() => onChange(moveChart(charts, chart.id, -1))}
                      disabled={i === 0}
                      aria-label={`Subir cifrado ${i + 1}`}
                      className="rounded border border-accent/20 px-2 py-1.5 font-label text-[10px] uppercase tracking-widest text-mono-500 transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-30"
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(moveChart(charts, chart.id, 1))}
                      disabled={i === charts.length - 1}
                      aria-label={`Bajar cifrado ${i + 1}`}
                      className="rounded border border-accent/20 px-2 py-1.5 font-label text-[10px] uppercase tracking-widest text-mono-500 transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-30"
                    >
                      Bajar
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(removeChart(charts, chart.id))}
                      aria-label={`Eliminar cifrado ${i + 1}`}
                      className="rounded border border-accent/20 px-2 py-1.5 font-label text-[10px] uppercase tracking-widest text-mono-500 transition-colors hover:border-negative-fg hover:text-negative-fg"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor={contentId} className="font-label text-xs uppercase tracking-widest text-mono-500">
                    Cifrado
                  </label>
                  <textarea
                    id={contentId}
                    className="w-full resize-none rounded-lg border border-edge-control bg-transparent px-3 py-2 font-mono text-xs leading-relaxed transition-colors focus:border-accent focus:outline-none"
                    rows={8}
                    value={chart.content}
                    onChange={(e) => onChange(updateChart(charts, chart.id, { content: e.target.value }))}
                    placeholder={"# Verso 1\n[Am]Ante Ti [F]Postrado estoy"}
                    spellCheck={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="font-label text-[11px] uppercase tracking-wide text-mono-600">
        Un cifrado por tonalidad · [Acorde]palabra
      </p>
    </div>
  );
}

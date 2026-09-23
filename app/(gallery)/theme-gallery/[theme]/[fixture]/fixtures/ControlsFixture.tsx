"use client";

// Controls fixture — every control primitive in every state, both themes (spec
// §5.11). Hermetic: no session, no fetch, no Sanity, no env. Mounts its own
// ToastProvider (the gallery mounts no Provider) and fires three toasts on
// mount so the stack is PRESENT for the capture. GalleryMotion (layout.tsx)
// provides motion features synchronously and skips animations under
// data-motion="off", so every frame here is final.

import { useEffect, useRef, useState } from "react";
import Button from "@/app/components/ui/Button";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Switch from "@/app/components/ui/Switch";
import Checkbox from "@/app/components/ui/Checkbox";
import Select from "@/app/components/ui/Select";
import DateField from "@/app/components/ui/DateField";
import NumberRoll from "@/app/components/ui/NumberRoll";
import Collapse from "@/app/components/ui/Collapse";
import Menu, { MenuItem } from "@/app/components/ui/Menu";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { ToastProvider, useToast } from "@/app/components/ui/Toast";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-label text-[10px] uppercase tracking-[0.24em] text-accent">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Toasts() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ message: "Guardado", tone: "ok", hold: true });
    toast({ message: "Sin conexión", tone: "error", hold: true });
    toast({ message: "Deshacer", tone: "info", hold: true, action: { label: "Deshacer", onClick: () => {} } });
  }, [toast]);
  return null;
}

// The panel opens itself on mount, the way the toasts fire themselves: a
// capture must find it already open, and `Menu` has no `defaultOpen` — the
// house rule is that its open state belongs to the trigger's own click.
function OpenMenu() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.click(); }, []);
  return (
    <Menu label="Acciones" trigger={<Button ref={ref} variant="secondary">Acciones ▾</Button>}>
      <MenuItem onSelect={() => {}}>Editar</MenuItem>
      <MenuItem selected onSelect={() => {}}>Ver como</MenuItem>
      <MenuItem danger onSelect={() => {}}>Eliminar</MenuItem>
    </Menu>
  );
}

function Controls() {
  const [seg, setSeg] = useState<"a" | "b" | "c">("b");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [sel, setSel] = useState("2");
  const [date, setDate] = useState("2026-09-13");
  const [n, setN] = useState(4);
  const [open, setOpen] = useState(true);
  return (
    // `pb-64` leaves the portalled, FIXED menu panel room below its trigger in
    // the capture — without it the panel would flip above the trigger or be cut.
    <div data-gallery-surface="controls" className="space-y-10 pb-64">
      <Row title="Botones">
        <Button variant="primary">Primario</Button>
        <Button variant="secondary">Secundario</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="danger">Peligro</Button>
        <Button variant="icon" aria-label="Icono">×</Button>
        <Button variant="pill" active>Píldora activa</Button>
        <Button variant="pill">Píldora</Button>
        <Button variant="primary" busy busyLabel="Guardando…">Guardar</Button>
        <Button variant="secondary" disabled>Deshabilitado</Button>
        <Button variant="primary" size="lg">Grande (44px)</Button>
        <Button variant="pill" tone="availability" active>Disponible</Button>
        <Button variant="icon" tone="danger" aria-label="Eliminar">×</Button>
        <Button variant="primary" size="sm">Pequeño</Button>
        <Button variant="secondary" size="sm">Pequeño</Button>
      </Row>
      <Row title="Segmentado">
        <SegmentedControl label="Contorno" value={seg} onChange={setSeg} options={[{ value: "a", label: "Uno" }, { value: "b", label: "Dos" }, { value: "c", label: "Tres", badge: 3 }]} />
        <SegmentedControl label="Relleno" tone="filled" value={seg} onChange={setSeg} options={[{ value: "a", label: "Calendario" }, { value: "b", label: "Lista" }, { value: "c", label: "Agenda", busy: true }]} />
        <SegmentedControl label="Vacío" size="sm" value={null} onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />
      </Row>
      <Row title="Interruptor">
        <Switch aria-label="Encendido" checked={on} onChange={setOn} />
        <Switch aria-label="Apagado" checked={!on} onChange={(v) => setOn(!v)} />
        <Switch aria-label="Pequeño" size="sm" checked={on} onChange={setOn} />
        <Switch aria-label="Deshabilitado" checked disabled onChange={() => {}} />
      </Row>
      <Row title="Casilla">
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>Marcada</Checkbox>
        <Checkbox checked={!checked} onChange={(e) => setChecked(!e.target.checked)}>Sin marcar</Checkbox>
        <Checkbox tone="negative" checked onChange={() => {}}>Negativa</Checkbox>
        <Checkbox checked disabled onChange={() => {}}>Deshabilitada</Checkbox>
      </Row>
      <Row title="Selector y fecha">
        <Select id="g-sel" label="Mes" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="1">Enero</option><option value="2">Febrero</option><option value="3">Marzo</option>
        </Select>
        <Select aria-label="Pequeño" size="sm" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="1">Uno</option><option value="2">Dos</option>
        </Select>
        <DateField kind="date" id="g-date" label="Fecha" value={date} onChange={(e) => setDate(e.target.value)} />
        <DateField kind="month" aria-label="Mes" value="2026-09" onChange={() => {}} onStep={() => {}} />
      </Row>
      <Row title="Número">
        <span className="font-display text-3xl text-accent"><NumberRoll value={n} /></span>
        <Button variant="secondary" size="sm" onClick={() => setN((v) => v + 1)}>+1</Button>
        <span className="rounded-full border border-positive-fg/25 px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-positive-fg"><NumberRoll value={`En ${n} días`} /></span>
      </Row>
      <Row title="Desplegable">
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Alternar</Button>
        <Collapse open={open} id="g-collapse" className="w-full rounded-lg border border-surface-accent-30 p-4 text-sm">Contenido desplegado.</Collapse>
      </Row>
      <Row title="Esqueleto">
        <SkeletonGroup label="Cargando" className="w-full space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton rounded="lg" className="h-16 w-full" />
        </SkeletonGroup>
      </Row>
      <Row title="Menú">
        <OpenMenu />
      </Row>
      <Toasts />
    </div>
  );
}

export function ControlsFixture() {
  return (
    <ToastProvider>
      <Controls />
    </ToastProvider>
  );
}

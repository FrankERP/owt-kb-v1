import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../../components/ui/Skeleton";

// The shape `/me/ajustes` lands in: the back link and heading, then the one tall
// Ajustes card (Tema, Tamaño de texto, Perfil as three divided subsections).
export default function AjustesLoading() {
  return (
    <SkeletonGroup label="Cargando tus ajustes">
      <NavbarSkeleton />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        {/* Back link, heading. */}
        <div className="space-y-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-40" />
        </div>

        <Skeleton className="h-96" rounded="lg" />
      </div>
    </SkeletonGroup>
  );
}

import Link from "next/link";
import Image from "next/image";

export default function NotAMemberPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <Image src="/LogoOasis.png" alt="Oasis Worship Team" width={56} height={56} className="mx-auto" />
        <h1 className="font-display text-xl uppercase tracking-wide">Acceso no autorizado</h1>
        <p className="font-body text-sm text-gray-400">
          Tu cuenta no está registrada como miembro del equipo.
          Contacta a un administrador para que te agreguen.
        </p>
        <Link
          href="/auth/signin"
          className="inline-block font-label text-xs uppercase tracking-widest text-[#00bfff] hover:text-[#00bfff]/70 transition-colors"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    </div>
  );
}

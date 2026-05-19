"use client";

import { useState, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

interface NavMenuProps {
  user?: {
    name?: string | null;
    image?: string | null;
    role?: string;
  } | null;
  showSchedule?: boolean;
  showTags?: boolean;
  notifCount?: number;
}

function MenuItem({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls =
    "w-full text-left flex items-center gap-3 px-4 py-2.5 font-label text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] hover:bg-[#003572]/10 dark:hover:bg-[#00bfff]/10 transition-colors";
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}

export default function NavMenu({ user, showSchedule, showTags, notifCount = 0 }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isAdmin =
    user?.role === "super-admin" ||
    user?.role === "admin" ||
    user?.role === "content-editor";

  if (!user) {
    return (
      <Link
        href="/auth/signin"
        className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors"
      >
        Iniciar sesión
      </Link>
    );
  }

  const initials = user.name?.slice(0, 2).toUpperCase() ?? "??";
  const firstName = user.name?.split(" ")[0];

  return (
    <div ref={ref} className="relative">
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#010b17] group"
        aria-label="Menu"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? ""}
            width={36}
            height={36}
            className="rounded-full ring-2 ring-transparent group-hover:ring-[#00bfff]/40 transition-all"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[#003572] dark:bg-[#00bfff]/20 flex items-center justify-center ring-2 ring-transparent group-hover:ring-[#00bfff]/40 transition-all">
            <span className="font-label text-xs text-[#00bfff]">{initials}</span>
          </div>
        )}
        {notifCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-[#C8D8EB] dark:border-[#010b17] flex items-center justify-center">
            <span className="font-label text-[8px] text-white leading-none">{notifCount > 9 ? "9+" : notifCount}</span>
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/15 bg-[#C8D8EB] dark:bg-[#0a1929] shadow-2xl overflow-hidden z-50"
          onClick={() => setOpen(false)}
        >
          {/* User identity */}
          <div className="px-4 py-3 border-b border-[#003572]/15 dark:border-[#00bfff]/10">
            {user.image ? (
              <div className="flex items-center gap-2.5 mb-0">
                <Image src={user.image} alt={user.name ?? ""} width={28} height={28} className="rounded-full" />
                <span className="font-label text-xs uppercase tracking-widest text-gray-400">{firstName}</span>
              </div>
            ) : (
              <span className="font-label text-xs uppercase tracking-widest text-gray-400">{firstName}</span>
            )}
          </div>

          {/* Navigation links */}
          <div className="py-1">
            <MenuItem href="/me">Mi perfil</MenuItem>
            {showSchedule && <MenuItem href="/schedule">Calendario</MenuItem>}
            {showTags && <MenuItem href="/tag">#Tags</MenuItem>}
            {isAdmin && <MenuItem href="/admin">Admin</MenuItem>}
          </div>

          {/* Sign out */}
          <div className="border-t border-[#003572]/15 dark:border-[#00bfff]/10 py-1">
            <MenuItem onClick={() => signOut({ callbackUrl: "/" })}>
              Cerrar sesión
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

import React from "react";
import Link from "next/link";
import Image from "next/image";

const CmsNavbar = () => {
	return (
		<header className="border-b border-brand-beam/15 bg-brand-blackout/85 backdrop-blur-md">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
				<Link className="flex min-w-0 items-center gap-2.5" href="/" aria-label="Volver a Backstage">
					<Image
						src="/icons/backstage-v2-192.png"
						alt=""
						width={40}
						height={40}
						className="brand-lockup-mark h-10 w-10 rounded-[12px]"
					/>
					<div className="min-w-0 leading-none">
						<p className="font-display text-base uppercase tracking-[0.12em] text-brand-frost">Backstage</p>
						<p className="mt-1 font-label text-[10px] uppercase tracking-[0.2em] text-brand-steel">Oasis Worship Team</p>
					</div>
				</Link>
				<div className="text-right">
					<p className="font-label text-[10px] uppercase tracking-[0.2em] text-brand-beam">Administración</p>
					<p className="mt-1 font-display text-base uppercase tracking-[0.08em] text-brand-frost">Content Studio</p>
				</div>
			</div>
		</header>
	);
};

export default CmsNavbar;

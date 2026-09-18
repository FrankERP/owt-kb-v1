"use client";

// A tutorial embed that costs nothing until it is asked for (R6, spec §19.5 row
// "Tutorial embeds", decision P). Three YouTube iframes used to boot on every
// song page load; now each one paints a poster and mounts its player on press.
//
// The poster is YouTube's own still (`i.ytimg.com`, allow-listed in
// next.config.mjs), so no new asset pipeline. `alt=""` because the image says
// nothing the ▶ button's label does not — the button is the accessible name.
//
// No id (a Vimeo link, a bare embed URL) → today's raw iframe, unchanged. The
// poster path is an enhancement for YouTube, never a gate on anything else.

import { useState } from "react";
import Image from "next/image";
import Button from "@/app/components/ui/Button";
import Presence from "@/app/components/ui/Presence";
import { extractYouTubeId } from "@/app/utils/practiceVideo";

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

// `url` is OPTIONAL because the Sanity `tutorial` object requires neither field.
// A row with no url rendered an iframe with no `src` before this; it now renders
// nothing, which is the same empty box without a self-embed waiting to happen.
export default function TutorialPoster({ url, title }: { url?: string | null; title?: string | null }) {
  const [playing, setPlaying] = useState(false);

  if (!url) return null;

  const id = extractYouTubeId(url);
  const name = title?.trim() || "el tutorial";

  if (!id) {
    return (
      <iframe
        src={url}
        width="100%"
        height="100%"
        className="border-0"
        title={title ?? undefined}
        allow={IFRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      {!playing && (
        <>
          <Image
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-scrim/20">
            <Button
              variant="primary"
              size="lg"
              aria-label={`Reproducir ${name}`}
              onClick={() => setPlaying(true)}
            >
              ▶ Reproducir
            </Button>
          </div>
        </>
      )}

      <Presence show={playing} variant="fade" className="absolute inset-0">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          width="100%"
          height="100%"
          className="border-0"
          title={title ?? undefined}
          allow={IFRAME_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </Presence>
    </div>
  );
}

// What the admin assistant's tools hand the model (ADR-0060): the MCP payloads minus everything
// only a write tool needs, and the lyrics as the song page shows them (ADR-0018).

import { describe, expect, it } from "vitest";

import type { GetServicePayload, ListServicesPayload } from "@/app/mcp/reads/servicePresenter";
import type { GetSongPayload } from "@/app/mcp/reads/songPresenter";
import {
  CHAT_LYRICS_MAX_CHARS,
  CHAT_PLAY_HISTORY_LIMIT,
  chatLyricsView,
  chatServiceListView,
  chatServiceView,
  chatSongView,
  type SongLyricsRow,
} from "../adminChatViews";

describe("chatLyricsView", () => {
  const row = (over: Partial<SongLyricsRow> = {}): SongLyricsRow => ({
    _id: "song-1",
    title: "Gracia",
    key: "G",
    lyricsText: "Tu gracia me alcanzó",
    charts: null,
    ...over,
  });

  it("gives the lyrics when there is no chart", () => {
    expect(chatLyricsView(row())).toEqual({ title: "Gracia", baseKey: "G", source: "lyrics", lyrics: "Tu gracia me alcanzó" });
  });

  it("gives the chart instead of the lyrics when one exists, as the song page does", () => {
    const view = chatLyricsView(row({ charts: [{ key: "G", content: "G   D\nTu gracia" }] }));
    expect(view).toMatchObject({ source: "chord_chart", chartKey: "G", chart: "G   D\nTu gracia", otherChartKeys: [] });
    expect(view).not.toHaveProperty("lyrics");
  });

  it("picks the asked key, else the base key, else the first chart; and lists the others", () => {
    const charts = [
      { key: "A", content: "A chart" },
      { key: "G", content: "G chart" },
      { key: "Bb", content: "Bb chart" },
    ];
    expect(chatLyricsView(row({ charts }), "bb")).toMatchObject({ chartKey: "Bb", otherChartKeys: ["A", "G"] });
    expect(chatLyricsView(row({ charts }))).toMatchObject({ chartKey: "G" });
    expect(chatLyricsView(row({ key: "E", charts }))).toMatchObject({ chartKey: "A" });
  });

  it("ignores an empty chart and says so when there is nothing at all", () => {
    expect(chatLyricsView(row({ lyricsText: "", charts: [{ key: "G", content: "  " }] }))).toMatchObject({ source: "none" });
  });

  it("clips very long text and flags it", () => {
    const view = chatLyricsView(row({ lyricsText: "x".repeat(CHAT_LYRICS_MAX_CHARS + 10) }));
    expect((view.lyrics as string).length).toBe(CHAT_LYRICS_MAX_CHARS);
    expect(view.truncated).toBe(true);
  });
});

describe("chatSongView", () => {
  it("drops the rehearsal mixes and bounds the play history", () => {
    const payload = {
      title: "Gracia",
      authors: [],
      artist: null,
      keys: ["G"],
      bpm: null,
      timeSig: null,
      tags: [],
      referenceLinks: { links: [], musicalReferenceUrl: null, lyricsVideoUrl: null, lyricsURL: null, tutorials: [] },
      lyrics: "visible",
      hasChordChart: false,
      rehearsalMixes: [{ tone: "G", mixes: [] }],
      playHistory: Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, service: "sunday", key: "G" })),
    } as GetSongPayload;
    const view = chatSongView(payload);
    expect(view).not.toHaveProperty("rehearsalMixes");
    expect((view.playHistory as unknown[]).length).toBe(CHAT_PLAY_HISTORY_LIMIT);
    expect(view.playHistoryTotal).toBe(20);
  });
});

describe("chatServiceView", () => {
  it("keeps who serves and what is sung, and none of the write tools' bookkeeping", () => {
    const seat = (name: string, extra: Record<string, unknown> = {}) => ({ itemKey: "k", memberId: "m", name, alias: null, ...extra });
    const payload = {
      serviceId: "role-1",
      kind: "sunday",
      date: "2026-10-25",
      published: "published",
      publishedRaw: true,
      seats: {
        Lead: [seat("Ana")],
        BGVs: [{ ...seat("Beto"), alias: "Bet" }],
        Chorus: null,
        instruments: [seat("Caro", { instrument: "Bajo" })],
        foh_team: [seat("Dani", { role: "Sonido" })],
      },
      setlist: {
        rows: [{ rowKey: "r1", song: { id: "song-1", title: "Gracia", author: "X" }, key: "G", medleyTag: null }],
        runs: [],
      },
      readiness: { blockers: "big" },
      observations: { roleId: "role-1", roleRev: "rev", seatItemKeys: {}, setlist: {} },
    } as unknown as GetServicePayload;
    const view = chatServiceView(payload);
    expect(view).toEqual({
      kind: "sunday",
      date: "2026-10-25",
      published: "published",
      team: {
        lead: ["Ana"],
        bgvs: ["Bet"],
        chorus: [],
        instruments: [{ name: "Caro", instrument: "Bajo" }],
        foh: [{ name: "Dani", role: "Sonido" }],
      },
      setlist: [{ songId: "song-1", title: "Gracia", author: "X", key: "G", medley: null }],
    });
    expect(JSON.stringify(view)).not.toMatch(/roleRev|itemKey|readiness|observations/);
  });
});

describe("chatServiceListView", () => {
  it("lists date, kind and publish state only", () => {
    const payload = {
      month: "2026-10",
      services: [
        { serviceId: "a", roleRev: "r", date: "2026-10-25", kind: "sunday", published: "draft", publishedRaw: false, passesNow: false, blockers: { hard: [], workflow: [] } },
        { serviceId: "b", roleRev: "r", date: "2026-10-31", kind: "special", name: "Noche", time: "19:00", published: "published", publishedRaw: true, passesNow: true, blockers: { hard: [], workflow: [] } },
      ],
    } as unknown as ListServicesPayload;
    expect(chatServiceListView(payload)).toEqual({
      month: "2026-10",
      services: [
        { date: "2026-10-25", kind: "sunday", published: "draft" },
        { date: "2026-10-31", kind: "special", name: "Noche", time: "19:00", published: "published" },
      ],
    });
  });
});

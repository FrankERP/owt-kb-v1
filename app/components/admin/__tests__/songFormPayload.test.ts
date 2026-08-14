import { describe, expect, it } from "vitest";
import { buildPayload, songToForm } from "../SongFormModal";
import { buildEditSongPayload } from "@/app/components/EditSongButton";
import { chartsFromSong, updateChart } from "@/app/utils/songFormCharts";
import type { PortableTextBody } from "@/app/utils/interface";

function asEditForm(song: Parameters<typeof songToForm>[0]) {
  return {
    ...songToForm(song),
    tutorials: [],
    musicalReferenceUrl: "",
    lyricsVideoUrl: "",
  };
}

const THREE_CHARTS = [
  { _key: "k-g", key: "G", content: "[G]Grande es tu fidelidad" },
  { _key: "k-a", key: "A", content: "[A]Grande es tu fidelidad" },
  { _key: "k-c", key: "C", content: "[C]Grande es tu fidelidad" },
];

const LYRICS_BODY: PortableTextBody = [
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    children: [{ _type: "span", _key: "s1", text: "Sublime gracia [Am]del Señor", marks: [] }],
  },
];

describe("songToForm/buildPayload", () => {
  it("a 3-chart song survives a no-op save with _key values intact", () => {
    const payload = buildPayload(songToForm({ title: "Grande", chords: THREE_CHARTS }));
    expect(payload.chords).toEqual(THREE_CHARTS);
    expect(payload.lyrics).toBe("");
  });

  it("a song with plain lyrics and [Am] markers and no charts round-trips lyrics, not a chart", () => {
    const payload = buildPayload(
      songToForm({ title: "Gracia", body: LYRICS_BODY, chords: [] }),
    );
    expect(payload.lyrics).toBe("Sublime gracia [Am]del Señor");
    expect(payload.chords).toEqual([]);
  });

  it("a song whose only lyrics live in chords[0].content round-trips that chart including _key", () => {
    const payload = buildPayload(
      songToForm({ title: "Grande", chords: [THREE_CHARTS[0]] }),
    );
    expect(payload.lyrics).toBe("");
    expect(payload.chords).toEqual([THREE_CHARTS[0]]);
  });

  it("a song with both body lyrics and N charts keeps both on a no-op save", () => {
    const payload = buildPayload(
      songToForm({ title: "Grande", body: LYRICS_BODY, chords: THREE_CHARTS }),
    );
    expect(payload.lyrics).toBe("Sublime gracia [Am]del Señor");
    expect(payload.chords).toEqual(THREE_CHARTS);
  });

  it("add / remove / reorder each produce the expected payload", () => {
    const form = songToForm({ title: "Grande", chords: THREE_CHARTS });
    const added = { ...form, charts: [...form.charts, { id: "new", key: "D", content: "[D]Nueva" }] };
    expect(buildPayload(added).chords).toEqual([
      ...THREE_CHARTS,
      { key: "D", content: "[D]Nueva" },
    ]);

    const removed = { ...form, charts: form.charts.filter((c) => c._key !== "k-a") };
    expect(buildPayload(removed).chords).toEqual([THREE_CHARTS[0], THREE_CHARTS[2]]);

    const reordered = {
      ...form,
      charts: [form.charts[2], form.charts[0], form.charts[1]],
    };
    expect(buildPayload(reordered).chords).toEqual([
      THREE_CHARTS[2],
      THREE_CHARTS[0],
      THREE_CHARTS[1],
    ]);

    const emptiedLast = {
      ...form,
      charts: updateChart(chartsFromSong([THREE_CHARTS[0]]), THREE_CHARTS[0]._key, { content: "" }),
    };
    expect(buildPayload(emptiedLast).chords).toEqual([]);
  });
});

describe("buildEditSongPayload", () => {
  it("a 3-chart song survives a no-op save with _key values intact", () => {
    const payload = buildEditSongPayload(asEditForm({ title: "Grande", chords: THREE_CHARTS }));
    expect(payload.chords).toEqual(THREE_CHARTS);
    expect(payload.lyrics).toBe("");
  });
});

describe("SongFormModal and EditSongButton agree on lyrics and chords", () => {
  it("buildPayload and buildEditSongPayload emit the same lyrics and chords for the same song", () => {
    const form = asEditForm({
      title: "Grande",
      body: LYRICS_BODY,
      chords: THREE_CHARTS,
      key: "G",
      bpm: 80,
      timeSig: "4/4",
    });
    const a = buildPayload(form);
    const b = buildEditSongPayload(form);
    expect(b.lyrics).toEqual(a.lyrics);
    expect(b.chords).toEqual(a.chords);
  });
});

const DATE_START = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}), /;
const KEY_PAT = /\(([A-G](#|b)?m?)\)/;
const LAST_KEY = /\(([A-G](#|b)?m?)\)(?![\s\S]*\([A-G](#|b)?m?\))/;
const DAY_HEADING = /^[\s*_]*(s[aá]bado|domingo)\b/i;
const MONTHS = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };

function stripAccents(s) { return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function ymd(y, m, d) { return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function dow(dateStr) { const [y,m,d]=dateStr.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)).getUTCDay(); }
function nextDow(fromStr, target) {
  const [y,m,d]=fromStr.split("-").map(Number);
  const base=new Date(Date.UTC(y,m-1,d));
  const add=((target - base.getUTCDay())%7+7)%7;
  return new Date(base.getTime()+add*86400000).toISOString().slice(0,10);
}

export function parseMessages(text) {
  const out = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(DATE_START);
    if (m) {
      if (cur) out.push(cur);
      const year = m[3].length === 2 ? "20" + m[3] : m[3];
      const date = ymd(year, +m[2], +m[1]);
      const rest = line.slice(m[0].length);          // "TIME - SENDER: BODY" (TIME has U+202F)
      let sender = "", body = rest;
      const dash = rest.indexOf(" - ");
      if (dash >= 0) {
        const after = rest.slice(dash + 3);
        const colon = after.indexOf(": ");
        if (colon >= 0) { sender = after.slice(0, colon); body = after.slice(colon + 2); }
        else body = after;
      }
      cur = { date, sender, body };
    } else if (cur) {
      cur.body += "\n" + line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function detectSetlists(messages) {
  return messages
    .map(m => ({ messageDate: m.date, body: m.body }))
    .filter(m => m.body.split("\n").filter(l => KEY_PAT.test(l)).length >= 3);
}

export function splitSections(body) {
  const sections = []; let cur = null;
  for (const line of body.split("\n")) {
    if (DAY_HEADING.test(line) && !KEY_PAT.test(line)) {
      if (cur) sections.push(cur);
      cur = { heading: line.trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      cur = { heading: null, lines: [line] };
    }
  }
  if (cur) sections.push(cur);
  return sections.filter(s => s.lines.some(l => KEY_PAT.test(l)));
}

export function parseSongLine(line) {
  const m = line.match(LAST_KEY);
  if (!m) return null;
  let name = line.slice(0, m.index);
  name = name.replace(/^\s*[-•*]\s*/, "").replace(/^\s*\d{1,2}[.)-]+\s*/, "");  // bullet / list-number prefix (incl. "1.-" / "1)" / "1-")
  name = name.replace(/\s*\|[^|]*$/, "");                                       // "| eeyev" tail
  name = name.replace(/\s*-\s+[^-]*$/, "");                                     // trailing " - Artist"
  name = name.trim();
  return name.length >= 2 ? { rawName: name, key: m[1] } : null;
}

export function serviceDateFor(heading, messageDate) {
  const t = stripAccents(heading || "").toLowerCase();
  const hasSun = /\bdomingo\b/.test(t), hasSat = /\bsabado\b/.test(t);
  const [my, mm] = messageDate.split("-").map(Number);

  const dmMon = t.match(/\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (dmMon) {
    const day = +dmMon[1], mon = MONTHS[dmMon[2]];
    const year = mon < mm ? (mon <= 2 && mm >= 11 ? my + 1 : my) : my;  // rollover only Dec->Jan/Feb
    const sd = ymd(year, mon, day);
    const wd = dow(sd);
    let type = wd === 6 ? "saturdarSongs" : "featuredSongs";
    let confidence = "explicit";
    if ((hasSun && wd !== 0) || (hasSat && wd !== 6)) confidence = "conflict";
    else if (hasSun) type = "featuredSongs"; else if (hasSat) type = "saturdarSongs";
    return { serviceDate: sd, type, confidence };
  }
  const dNum = t.match(/\b(sabado|domingo)\s+(\d{1,2})\b/);
  if (dNum) {
    const sd = ymd(my, mm, +dNum[2]);
    const wd = dow(sd);
    const wantSat = dNum[1] === "sabado";
    const confidence = (wantSat && wd !== 6) || (!wantSat && wd !== 0) ? "conflict" : "explicit";
    return { serviceDate: sd, type: wantSat ? "saturdarSongs" : "featuredSongs", confidence };
  }
  if (hasSun || hasSat) {
    const target = hasSat && !hasSun ? 6 : 0;
    return { serviceDate: nextDow(messageDate, target), type: target === 6 ? "saturdarSongs" : "featuredSongs", confidence: "day-word" };
  }
  return { serviceDate: nextDow(messageDate, 0), type: "featuredSongs", confidence: "inferred" };
}

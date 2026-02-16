import { PDFDocument, StandardFonts } from "pdf-lib";
import { calculateSineDayForYmd } from "../../js/sineday-engine.js";
import { duckUrlFromSinedayNumber } from "../../js/sineducks.js";

const MS_PER_DAY = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromParts(y, mIndex, d) {
  return `${y}-${pad2(mIndex + 1)}-${pad2(d)}`;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function monthMatrixUTC(year, monthIndex, weekStart) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const firstDow = first.getUTCDay();
  const lead = (firstDow - weekStart + 7) % 7;

  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - lead + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ inMonth: false, ymd: null, d: null });
    } else {
      cells.push({
        inMonth: true,
        ymd: ymdFromParts(year, monthIndex, dayNum),
        d: dayNum
      });
    }
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function weekdayLabels(locale, weekStart) {
  const dtf = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const baseSun = new Date(Date.UTC(2023, 0, 1, 12)); // Sunday
  const labels = [];
  for (let i = 0; i < 7; i++) labels.push(dtf.format(addDaysUTC(baseSun, i)));
  return labels.slice(weekStart).concat(labels.slice(0, weekStart));
}

async function loadDuckPngBytes(relativePath, origin) {
  // relativePath like "assets/sineducks/SineDuck1@3x.png"
  const clean = String(relativePath || "").replace(/^\/+/, "");
  const url = new URL("/" + clean, origin).toString();

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch duck asset: ${r.status} ${url}`);
  }

  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

async function buildDuckCache(pdf, origin) {
  const cache = new Map();
  for (let day = 1; day <= 18; day++) {
    const rel = duckUrlFromSinedayNumber(day);
    const bytes = await loadDuckPngBytes(rel, origin);
    const img = await pdf.embedPng(bytes);
    cache.set(day, img);
  }
  return cache;
}

function watermarkText(userEmailOrId) {
  const ts = new Date().toISOString();
  return `Generated for ${userEmailOrId} • ${ts}`;
}

export async function renderMonthPdf({
  year,
  monthIndex,
  locale = "en-US",
  weekStart = 0,
  profiles = [],
  titleSuffix = "",
  userMark = "",
  origin
}) {
  const W = 612;
  const H = 792;
  const margin = 36;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const duckCache = await buildDuckCache(pdf, origin);

  const dtfTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const title = dtfTitle.format(new Date(Date.UTC(year, monthIndex, 1, 12))) + (titleSuffix ? `  ·  ${titleSuffix}` : "");

  page.drawText(title, { x: margin, y: H - margin - 20, size: 18, font: bold });

  page.drawText(watermarkText(userMark), { x: margin, y: margin - 6 + 18, size: 8, font });

  const labels = weekdayLabels(locale, weekStart);
  const headerTop = H - margin - 52;
  const gridTop = headerTop - 18;
  const gridBottom = margin + 40;

  const gridW = W - margin * 2;
  const gridH = gridTop - gridBottom;

  const weeks = monthMatrixUTC(year, monthIndex, weekStart);
  const rows = weeks.length;
  const cols = 7;

  const cellW = gridW / cols;
  const cellH = gridH / rows;

  for (let c = 0; c < 7; c++) {
    page.drawText(labels[c], {
      x: margin + c * cellW + 4,
      y: headerTop - 2,
      size: 10,
      font: bold
    });
  }

  page.drawRectangle({ x: margin, y: gridBottom, width: gridW, height: gridH, borderWidth: 1 });

  for (let c = 1; c < cols; c++) {
    page.drawLine({
      start: { x: margin + c * cellW, y: gridBottom },
      end: { x: margin + c * cellW, y: gridTop },
      thickness: 0.75
    });
  }
  for (let r = 1; r < rows; r++) {
    page.drawLine({
      start: { x: margin, y: gridBottom + r * cellH },
      end: { x: margin + gridW, y: gridBottom + r * cellH },
      thickness: 0.75
    });
  }

  const duckSize = 22;
  const duckGap = 4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = weeks[r][c];
      const x0 = margin + c * cellW;
      const y0 = gridTop - (r + 1) * cellH;

      if (!cell.inMonth) continue;

      page.drawText(String(cell.d), {
        x: x0 + 5,
        y: y0 + cellH - 16,
        size: 12,
        font: bold
      });

      const yDuck = y0 + cellH - 16 - duckSize - 4;
      let xDuck = x0 + 5;

      for (const p of profiles) {
        const r1 = calculateSineDayForYmd(p.birthdate, cell.ymd);
        if (!r1) continue;

        const img = duckCache.get(r1.day);
        const scale = duckSize / img.height;

        page.drawImage(img, {
          x: xDuck,
          y: yDuck,
          width: img.width * scale,
          height: img.height * scale
        });

        xDuck += duckSize + duckGap;
        if (xDuck > x0 + cellW - duckSize) break;
      }
    }
  }

  return await pdf.save();
}

export async function renderWeekPdf({
  startYmd,
  locale = "en-US",
  profiles = [],
  titleSuffix = "",
  userMark = "",
  origin
}) {
  const W = 612;
  const H = 792;
  const margin = 36;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const duckCache = await buildDuckCache(pdf, origin);

  const [yy, mm, dd] = String(startYmd).split("-").map(Number);
  const start = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 12));

  const end = addDaysUTC(start, 6);
  const dtfRange = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const title = `${dtfRange.format(start)} – ${dtfRange.format(end)}` + (titleSuffix ? `  ·  ${titleSuffix}` : "");

  page.drawText(title, { x: margin, y: H - margin - 20, size: 16, font: bold });
  page.drawText(watermarkText(userMark), { x: margin, y: margin - 6 + 18, size: 8, font });

  const dtfDay = new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

  const top = H - margin - 50;
  const bottom = margin + 30;
  const usableH = top - bottom;

  const rowH = usableH / 7;

  const duckSize = 34;
  const duckGap = 6;

  for (let i = 0; i < 7; i++) {
    const d = addDaysUTC(start, i);
    const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

    const yTop = top - i * rowH;
    const yRow = yTop - rowH;

    page.drawRectangle({
      x: margin,
      y: yRow,
      width: W - margin * 2,
      height: rowH,
      borderWidth: 0.75
    });

    page.drawText(dtfDay.format(d), {
      x: margin + 6,
      y: yTop - 16,
      size: 10,
      font: bold
    });

    let xDuck = margin + 6;
    const yDuck = yTop - 16 - duckSize - 6;

    for (const p of profiles) {
      const r1 = calculateSineDayForYmd(p.birthdate, ymd);
      if (!r1) continue;

      const img = duckCache.get(r1.day);
      const scale = duckSize / img.height;

      page.drawImage(img, {
        x: xDuck,
        y: yDuck,
        width: img.width * scale,
        height: img.height * scale
      });

      xDuck += duckSize + duckGap;
      if (xDuck > W - margin - duckSize) break;
    }

    const linesLeft = margin + 6;
    const linesRight = W - margin - 6;
    const firstLineY = yRow + 10;
    const lastLineY = yTop - 18 - duckSize - 14;

    const lineCount = 5;
    const step = (lastLineY - firstLineY) / (lineCount + 1);

    for (let k = 1; k <= lineCount; k++) {
      const y = firstLineY + k * step;
      page.drawLine({
        start: { x: linesLeft, y },
        end: { x: linesRight, y },
        thickness: 0.5
      });
    }
  }

  return await pdf.save();
}

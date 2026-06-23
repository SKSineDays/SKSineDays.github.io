import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { calculateSineDayForYmd, DAY_DATA } from "../../js/sineday-engine.js";
import { duckUrlFromSinedayNumber } from "../../js/sineducks.js";
import { isRtlLocale } from "../../shared/i18n.js";

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
  const ordered = labels.slice(weekStart).concat(labels.slice(0, weekStart));
  return isRtlLocale(locale) ? ordered.slice().reverse() : ordered;
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

import { getSineDayCopyrightText } from "../../shared/footer-text.js";

const FOOTER_SIZE = 9;
const FOOTER_LEFT_MARGIN = 12;
const FOOTER_BOTTOM = 18;

function drawFooter(page, font, _pageW, year) {
  const gray = rgb(0.45, 0.45, 0.45);
  const text = getSineDayCopyrightText(year);
  page.drawText(text, {
    x: FOOTER_LEFT_MARGIN,
    y: FOOTER_BOTTOM,
    size: FOOTER_SIZE,
    font,
    color: gray
  });
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
  // Letter landscape (8.5" x 11")
  const W = 792;
  const H = 612;
  const margin = 36;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);
  // Explicit white page background (prevents Safari/Preview "black fill" artifacts)
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const duckCache = await buildDuckCache(pdf, origin);
  const rtl = isRtlLocale(locale);

  const dtfTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const title = dtfTitle.format(new Date(Date.UTC(year, monthIndex, 1, 12))) + (titleSuffix ? `  ·  ${titleSuffix}` : "");

  page.drawText(title, { x: margin, y: H - margin - 20, size: 18, font: bold });

  drawFooter(page, font, W, year);

  const labels = weekdayLabels(locale, weekStart);
  const headerTop = H - margin - 52;
  const gridTop = headerTop - 18;
  const gridBottom = margin + 40;

  const gridW = W - margin * 2;
  const gridH = gridTop - gridBottom;

  const weeks = monthMatrixUTC(year, monthIndex, weekStart);
  const rows = weeks.length;
  const cols = 7;

  const gap = 6;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;

  const borderColor = rgb(0.68, 0.68, 0.68);
  const outFill = rgb(0.97, 0.97, 0.97);

  for (let c = 0; c < 7; c++) {
    page.drawText(labels[c], {
      x: margin + c * (cellW + gap) + 4,
      y: headerTop - 2,
      size: 10,
      font: bold
    });
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dc = rtl ? cols - 1 - c : c;
      const cell = weeks[r][dc];
      const x0 = margin + c * (cellW + gap);
      const y0 = gridTop - (r + 1) * cellH - r * gap;
      page.drawRectangle({
        x: x0,
        y: y0,
        width: cellW,
        height: cellH,
        borderWidth: 1.25,
        borderColor,
        color: cell.inMonth ? rgb(1, 1, 1) : outFill
      });
    }
  }

  const duckSize = 22;
  const duckGap = 4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dc = rtl ? cols - 1 - c : c;
      const cell = weeks[r][dc];
      const x0 = margin + c * (cellW + gap);
      const y0 = gridTop - (r + 1) * cellH - r * gap;

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
        const w = img.width * scale;
        const h = img.height * scale;

        if (rtl) {
          page.drawImage(img, { x: xDuck + w, y: yDuck, width: -w, height: h });
        } else {
          page.drawImage(img, { x: xDuck, y: yDuck, width: w, height: h });
        }

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
  const W = 612; // Letter portrait
  const H = 792;
  const margin = 36;

  const pdf = await PDFDocument.create();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const duckCache = await buildDuckCache(pdf, origin);
  const rtl = isRtlLocale(locale);

  const [yy, mm, dd] = String(startYmd).split("-").map(Number);
  const start = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 12));

  const end = addDaysUTC(start, 6);
  const dtfRange = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  const title =
    `${dtfRange.format(start)} – ${dtfRange.format(end)}` +
    (titleSuffix ? `  ·  ${titleSuffix}` : "");

  const dtfDay = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });

  const duckSize = 34;
  const duckGap = 6;

  // 2-page weekly: Page 1 = first 4 days, Page 2 = last 3 days
  const splits = [
    [0, 1, 2, 3],
    [4, 5, 6]
  ];

  for (let pageIndex = 0; pageIndex < splits.length; pageIndex++) {
    const indices = splits[pageIndex];

    const page = pdf.addPage([W, H]);

    // White background (prevents Safari/Preview black fill artifacts)
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

    // Title + footer on BOTH pages (so printing single sheets still looks correct)
    page.drawText(title, { x: margin, y: H - margin - 20, size: 16, font: bold });
    drawFooter(page, font, W, yy);

    const top = H - margin - 50;
    const bottom = margin + 30;
    const usableH = top - bottom;

    // Bigger rows because fewer days per page
    const rowH = usableH / indices.length;

    for (let row = 0; row < indices.length; row++) {
      const i = indices[row];
      const d = addDaysUTC(start, i);
      const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

      const yTop = top - row * rowH;
      const yRow = yTop - rowH;

      // Day box (white fill + light border)
      page.drawRectangle({
        x: margin,
        y: yRow,
        width: W - margin * 2,
        height: rowH,
        borderWidth: 1.25,
        borderColor: rgb(0.68, 0.68, 0.68),
        color: rgb(1, 1, 1)
      });

      // Day label
      page.drawText(dtfDay.format(d), {
        x: margin + 6,
        y: yTop - 16,
        size: 10,
        font: bold
      });

      // Ducks
      let xDuck = margin + 6;
      const yDuck = yTop - 16 - duckSize - 6;

      for (const p of profiles) {
        const r1 = calculateSineDayForYmd(p.birthdate, ymd);
        if (!r1) continue;

        const img = duckCache.get(r1.day);
        const scale = duckSize / img.height;
        const w = img.width * scale;
        const h = img.height * scale;

        if (rtl) {
          page.drawImage(img, { x: xDuck + w, y: yDuck, width: -w, height: h });
        } else {
          page.drawImage(img, { x: xDuck, y: yDuck, width: w, height: h });
        }

        xDuck += duckSize + duckGap;
        if (xDuck > W - margin - duckSize) break;
      }

      // Writing lines (auto-scale based on available height)
      const linesLeft = margin + 6;
      const linesRight = W - margin - 6;
      const firstLineY = yRow + 10;
      const lastLineY = yTop - 18 - duckSize - 14;
      const available = Math.max(0, lastLineY - firstLineY);

      // ~14pt spacing => more lines now that rows are taller
      const lineCount = Math.max(6, Math.floor(available / 14));
      const step = available / (lineCount + 1);

      for (let k = 1; k <= lineCount; k++) {
        const y = firstLineY + k * step;
        page.drawLine({
          start: { x: linesLeft, y },
          end: { x: linesRight, y },
          thickness: 0.65,
          color: rgb(0.74, 0.74, 0.74)
        });
      }
    }
  }

  return await pdf.save();
}

function drawScaledImage(page, img, centerX, y, targetH) {
  const scale = targetH / img.height;
  const width = img.width * scale;
  page.drawImage(img, {
    x: centerX - width / 2,
    y,
    width,
    height: targetH
  });
}

function drawWritingLines(page, { x1, x2, startY, count, step }) {
  for (let i = 0; i < count; i++) {
    const y = startY - i * step;
    page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: 0.55,
      color: rgb(0.82, 0.82, 0.82)
    });
  }
}

export async function renderDayPdf({
  dateYmd,
  locale = "en-US",
  profiles = [],
  titleSuffix = "",
  userMark = "",
  origin
}) {
  const W = 612;
  const H = 792;
  const margin = 36;
  const black = rgb(0, 0, 0);
  const lightBorder = rgb(0.78, 0.78, 0.78);
  const softFill = rgb(0.985, 0.985, 0.985);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const duckCache = await buildDuckCache(pdf, origin);

  const [yy, mm, dd] = String(dateYmd).split("-").map(Number);
  const date = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 12));

  const profile = profiles[0] || null;
  const result = profile?.birthdate ? calculateSineDayForYmd(profile.birthdate, dateYmd) : null;
  const dayNumber = result?.day || null;
  const dayInfo = dayNumber ? DAY_DATA.find((d) => d.day === dayNumber) : null;

  const dateText = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);

  drawFooter(page, font, W, yy || new Date().getUTCFullYear());

  const prompt = "How do you feel today? Circle a duck.";
  page.drawText(prompt, {
    x: margin,
    y: H - margin - 4,
    size: 12,
    font: bold,
    color: black
  });

  const cardGap = 4;
  const cardW = (W - margin * 2 - cardGap * 8) / 9;
  const cardH = 58;
  const topCardY = H - margin - 72;
  const bottomCardY = margin + 28;

  function drawMoodDuck(day, rowY, col) {
    const x = margin + col * (cardW + cardGap);

    page.drawRectangle({
      x,
      y: rowY,
      width: cardW,
      height: cardH,
      borderWidth: 0.9,
      borderColor: lightBorder,
      color: softFill
    });

    const img = duckCache.get(day);
    if (img) drawScaledImage(page, img, x + cardW / 2, rowY + 17, 32);

    const label = String(day);
    const labelW = bold.widthOfTextAtSize(label, 8);
    page.drawText(label, {
      x: x + cardW / 2 - labelW / 2,
      y: rowY + 7,
      size: 8,
      font: bold,
      color: black
    });
  }

  for (let day = 1; day <= 9; day++) drawMoodDuck(day, topCardY, day - 1);

  const bottomPrompt = "Choose the duck that matches the moment.";
  page.drawText(bottomPrompt, {
    x: margin,
    y: bottomCardY + cardH + 10,
    size: 10,
    font,
    color: black
  });

  for (let day = 10; day <= 18; day++) drawMoodDuck(day, bottomCardY, day - 10);

  const middleTop = topCardY - 28;
  const middleBottom = bottomCardY + cardH + 34;
  const middleX = margin;
  const middleW = W - margin * 2;
  const centerX = W / 2;

  page.drawRectangle({
    x: middleX,
    y: middleBottom,
    width: middleW,
    height: middleTop - middleBottom,
    borderWidth: 1.25,
    borderColor: rgb(0.72, 0.72, 0.72),
    color: rgb(1, 1, 1)
  });

  const dateW = bold.widthOfTextAtSize(dateText, 18);
  page.drawText(dateText, {
    x: centerX - dateW / 2,
    y: middleTop - 34,
    size: 18,
    font: bold,
    color: black
  });

  const profileText = titleSuffix ? `Journal page for ${titleSuffix}` : "Daily SineDay journal page";
  const profileW = font.widthOfTextAtSize(profileText, 10);
  page.drawText(profileText, {
    x: centerX - profileW / 2,
    y: middleTop - 52,
    size: 10,
    font,
    color: black
  });

  if (dayNumber) {
    const todayDuck = duckCache.get(dayNumber);
    if (todayDuck) drawScaledImage(page, todayDuck, centerX, middleTop - 142, 78);

    const dayTitle = `Today's SineDuck: Day ${dayNumber}`;
    const dayTitleW = bold.widthOfTextAtSize(dayTitle, 14);
    page.drawText(dayTitle, {
      x: centerX - dayTitleW / 2,
      y: middleTop - 162,
      size: 14,
      font: bold,
      color: black
    });

    if (dayInfo?.phase) {
      const phase = String(dayInfo.phase).replace(/\s*•\s*/g, " - ");
      const phaseW = font.widthOfTextAtSize(phase, 9);
      page.drawText(phase, {
        x: centerX - phaseW / 2,
        y: middleTop - 178,
        size: 9,
        font,
        color: black
      });
    }

    if (dayInfo?.description) {
      const descW = font.widthOfTextAtSize(dayInfo.description, 10);
      page.drawText(dayInfo.description, {
        x: centerX - descW / 2,
        y: middleTop - 196,
        size: 10,
        font,
        color: black
      });
    }
  }

  page.drawText("Today's thoughts", {
    x: middleX + 16,
    y: middleTop - 232,
    size: 13,
    font: bold,
    color: black
  });

  drawWritingLines(page, {
    x1: middleX + 16,
    x2: middleX + middleW - 16,
    startY: middleTop - 260,
    count: 11,
    step: 18
  });

  return await pdf.save();
}

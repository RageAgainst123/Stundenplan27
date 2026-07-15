// HTML-Export (2026-07): der Stundenplan als EINE eigenständige HTML-Datei
// zum Weitergeben — Kollegen öffnen sie direkt im Browser (Handy zuerst).
//
// Design-Entscheidungen:
//  - Alles wird beim Export in TypeScript VOR-GERENDERT (Tages-Tabellen,
//    Chips, Farben) — das eingebettete JavaScript macht nur noch
//    Tab-Wechsel und Filter-Dimmen (~50 Zeilen, kein Framework, keine
//    eingebetteten Daten → kein JSON-Escaping-Risiko).
//  - Lehrer-Tints (40 %-Aufhellung, identisch zur App-Formel in
//    teacher-helpers.ts) werden als fertige Hex-Werte vorgerechnet —
//    kein color-mix im Ziel-Browser nötig, läuft auch auf älteren Handys.
//  - Keine externen Referenzen (Fonts, Skripte, Bilder) — die Datei
//    funktioniert offline und überall.
//
// Datenquelle: buildScheduleExport (schedule-export.ts) — liefert
// Placements mit aufgelösten Lehrern (Name/Kürzel/Farbe, effektives
// Segment-Team bei Team-Teaching), Fach-Namen, G/U-Muster und die
// byDay-Denormalisierung [Tag][Stunde][Stufe].

import type { Day, ScheduleDoc } from './types';
import { DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES } from './types';
import { buildScheduleExport } from './schedule-export';
import { FALLBACK_TEACHER_COLOR } from './teacher-helpers';
import { hexByte } from './format';

const DAY_FULL: Record<Day, string> = {
	Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag',
};

/** HTML-Escaping für alle nutzergelieferten Strings (Namen, Fächer, Jahr). */
function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * 40 %-Lehrerfarb-Tint als Hex (Blend Richtung Weiß) — dieselbe Optik wie
 * `teacherTint` in der App, aber ohne color-mix-Abhängigkeit im Output.
 */
export function tintHex(hex: string, colorShare = 0.4): string {
	const clean = (hex ?? '').replace('#', '').padEnd(6, '0').slice(0, 6);
	const ch = (i: number) => parseInt(clean.slice(i, i + 2), 16) || 0;
	const blend = (v: number) => Math.round(v * colorShare + 255 * (1 - colorShare));
	return `#${hexByte(blend(ch(0)))}${hexByte(blend(ch(2)))}${hexByte(blend(ch(4)))}`;
}

interface CellTeacher { id: string; name: string; color: string; shortNumber: number }

/** Hintergrund einer Stunden-Karte: Tint bzw. Streifen-Gradient (Team). */
function cardBackground(teachers: CellTeacher[]): string {
	if (teachers.length === 0) return tintHex(FALLBACK_TEACHER_COLOR);
	if (teachers.length === 1) return tintHex(teachers[0].color);
	const stops = teachers.map((t, i) => {
		const from = ((i / teachers.length) * 100).toFixed(1);
		const to = (((i + 1) / teachers.length) * 100).toFixed(1);
		return `${tintHex(t.color)} ${from}% ${to}%`;
	}).join(', ');
	return `linear-gradient(to right, ${stops})`;
}

/**
 * Baut die komplette Single-File-HTML-Seite für den aktuellen Plan.
 * Rein (keine Mutation), synchron, keine Abhängigkeiten im Output.
 */
export function buildHtmlPlan(doc: ScheduleDoc): string {
	const data = buildScheduleExport(doc);
	const dateStr = new Date().toLocaleDateString('de-AT', {
		day: '2-digit', month: '2-digit', year: 'numeric',
	});

	// ---- Lehrer-Filter-Chips (nur Lehrer mit Stunden) ----
	const activeTeacherIds = new Set<string>();
	for (const p of data.placements) for (const t of p.teachers) activeTeacherIds.add(t.id);
	const teachers = data.teachers
		.filter(t => activeTeacherIds.has(t.id))
		.sort((a, b) => a.shortNumber - b.shortNumber);

	const chipsHtml = [
		`<button class="chip on" data-teacher="" type="button">Alle</button>`,
		...teachers.map(t =>
			`<button class="chip" data-teacher="${esc(t.id)}" type="button"` +
			` style="--tc:${esc(t.color)};--tint:${tintHex(t.color)}">` +
			`${esc(t.name.split(' ')[0])} <span class="lnum">L${t.shortNumber}</span></button>`
		),
	].join('');

	// ---- Eine Stunden-Karte ----
	const card = (p: (typeof data.placements)[number]): string => {
		const badges = p.teachers.length <= 3
			? p.teachers.map(t => `L${t.shortNumber}`).join(' ')
			: p.teachers.slice(0, 2).map(t => `L${t.shortNumber}`).join(' ') + ` +${p.teachers.length - 2}`;
		const week = p.weekPattern === 'every' ? '' :
			`<span class="wk">${p.weekPattern === 'even' ? 'G' : 'U'}</span>`;
		const tids = p.teachers.map(t => t.id).join(' ');
		const names = p.teachers.map(t => t.name).join(' + ');
		const border = p.teachers[0]?.color ?? FALLBACK_TEACHER_COLOR;
		return `<div class="lesson" data-teachers="${esc(tids)}"` +
			` style="background:${cardBackground(p.teachers)};border-left-color:${esc(border)}"` +
			` title="${esc(`${p.subjectName} · ${names}`)}">` +
			`<span class="subj">${esc(p.subject)}</span>` +
			`<span class="meta">${esc(badges)}${week}</span></div>`;
	};

	// ---- Tages-Tabelle (P1-P8 × 4 Stufen) — für Tages-Tabs UND FULL ----
	const dayTable = (day: Day): string => {
		const rows = PERIODS.map((period, pIdx) => {
			const cells = GRADES.map(grade => {
				const list = data.byDay[day]?.[period]?.[grade] ?? [];
				return `<td>${list.map(card).join('')}</td>`;
			}).join('');
			return `<tr><th class="pcol"><span class="pn">${period}.</span>` +
				`<span class="pt">${DEFAULT_PERIOD_TIMES[pIdx]}</span></th>${cells}</tr>`;
		}).join('');
		const heads = GRADES.map(g => `<th class="gh">${g}.</th>`).join('');
		return `<table class="plan"><thead><tr><th class="pcol"></th>${heads}</tr></thead>` +
			`<tbody>${rows}</tbody></table>`;
	};

	const dayBlocks = DAYS.map(d =>
		`<section class="dayblock"><h2>${DAY_FULL[d]}</h2>${dayTable(d)}</section>`
	).join('');

	const tabsHtml =
		DAYS.map(d => `<button class="tab" data-tab="${d}" type="button">${d.toUpperCase()}</button>`).join('') +
		`<button class="tab" data-tab="FULL" type="button">FULL</button>`;

	const panelsHtml =
		DAYS.map(d =>
			`<section class="panel" data-panel="${d}" hidden>` +
			`<h2 class="dayname">${DAY_FULL[d]}</h2>${dayTable(d)}</section>`
		).join('') +
		`<section class="panel" data-panel="FULL" hidden><div class="fullwrap">${dayBlocks}</div></section>`;

	const legendHtml = teachers.map(t =>
		`<span class="lg"><span class="dot" style="background:${esc(t.color)}"></span>` +
		`<b>L${t.shortNumber}</b> ${esc(t.name)}</span>`
	).join('');

	const emptyHint = data.placements.length === 0
		? `<p class="empty">Dieser Plan enthält noch keine Stunden.</p>`
		: '';

	// Hinweis: Das Runtime-Skript ist STATISCH (keine Nutzerdaten) und
	// enthält bewusst keine "</script>"-Sequenz.
	return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stundenplan ${esc(doc.schoolYear)}</title>
<style>
:root { --border:#d7dbe0; --muted:#5f6672; --bg:#f4f5f7; --accent:#2f6fed; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:#1c2430; font-size:15px; }
header.top { position:sticky; top:0; z-index:10; background:#fff; border-bottom:1px solid var(--border); padding:10px 12px 0; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.title { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.title h1 { font-size:18px; }
.title .sub { color:var(--muted); font-size:12px; }
.chips { display:flex; gap:6px; overflow-x:auto; padding:8px 0; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
.chip { flex:0 0 auto; border:1.5px solid var(--border); background:#fff; border-radius:999px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.chip .lnum { font-size:11px; opacity:.65; }
.chip[data-teacher=""] { border-color:#98a1ad; }
.chip.on { border-color:var(--tc,#1c2430); background:var(--tint,#e8ecf2); box-shadow:inset 0 0 0 1px var(--tc,transparent); }
.tabs { display:flex; gap:4px; padding:0 0 8px; overflow-x:auto; }
.tab { flex:1 0 auto; min-width:52px; border:1px solid var(--border); background:#fff; border-radius:8px; padding:8px 6px; font-size:14px; font-weight:700; cursor:pointer; color:var(--muted); }
.tab.on { background:var(--accent); border-color:var(--accent); color:#fff; }
main { padding:10px 8px 20px; max-width:1200px; margin:0 auto; }
.dayname { font-size:15px; margin:2px 2px 8px; color:var(--muted); }
table.plan { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.plan th, .plan td { border:1px solid #e7eaee; padding:2px; vertical-align:top; }
.plan thead th { background:#eef1f5; font-size:11px; color:var(--muted); padding:5px 2px; }
.plan .gh { min-width:0; width:23%; }
.plan .pcol { width:44px; background:#f7f8fa; text-align:center; padding:4px 2px; }
.pn { display:block; font-weight:800; font-size:12px; }
.pt { display:block; font-size:9px; color:var(--muted); white-space:nowrap; }
.plan td { height:38px; }
.lesson { border-left:3px solid ${FALLBACK_TEACHER_COLOR}; border-radius:5px; padding:3px 5px; margin:1px 0; transition:opacity .15s; }
.lesson .subj { display:block; font-weight:800; font-size:12px; line-height:1.15; }
.lesson .meta { display:block; font-size:10px; color:#333; font-family:ui-monospace,Menlo,Consolas,monospace; }
.lesson .wk { margin-left:4px; font-weight:800; color:#7c3aed; }
body.filtered .lesson:not(.match) { opacity:.16; }
.fullwrap { display:flex; flex-direction:column; gap:14px; }
.dayblock h2 { font-size:15px; margin:0 2px 6px; color:var(--muted); }
.empty { padding:30px 10px; text-align:center; color:var(--muted); }
footer.legend { max-width:1200px; margin:6px auto 0; padding:10px 12px 26px; display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:#333; }
.legend .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; }
.legend .hint { flex-basis:100%; color:var(--muted); }
@media (min-width:900px) {
  .title h1 { font-size:22px; }
  .fullwrap { flex-direction:row; align-items:flex-start; }
  .dayblock { flex:1 1 0; min-width:0; }
  .plan td { height:44px; }
}
@media print {
  header.top .chips, .tabs { display:none; }
  .panel[hidden] { display:none; }
  body { background:#fff; }
  table.plan { box-shadow:none; }
}
</style>
</head>
<body>
<header class="top">
	<div class="title">
		<h1>Stundenplan ${esc(doc.schoolYear)}</h1>
		<span class="sub">Stand ${dateStr} · Spalten = 5.–8. Schulstufe · G/U = gerade/ungerade Woche</span>
	</div>
	<div class="chips" role="toolbar" aria-label="Lehrer-Filter">${chipsHtml}</div>
	<div class="tabs" role="tablist">${tabsHtml}</div>
</header>
<main>
${emptyHint}
${panelsHtml}
</main>
<footer class="legend">${legendHtml}<span class="hint">Lehrer oben antippen, um nur dessen Stunden hervorzuheben — erneut antippen für alle.</span></footer>
<script>
(function () {
	'use strict';
	// ---- Tabs: MO-FR + FULL; beim Öffnen ist HEUTE aktiv (Sa/So: FULL).
	var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
	var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
	function showTab(id) {
		tabs.forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === id); });
		panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== id; });
	}
	tabs.forEach(function (t) {
		t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
	});
	var byIdx = ['FULL', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'FULL'];
	showTab(byIdx[new Date().getDay()] || 'FULL');

	// ---- Lehrer-Filter: ein Chip aktiv; fremde Stunden werden gedimmt.
	var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
	var lessons = Array.prototype.slice.call(document.querySelectorAll('.lesson'));
	function applyFilter(tid) {
		chips.forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-teacher') === tid); });
		document.body.classList.toggle('filtered', tid !== '');
		lessons.forEach(function (l) {
			var ids = (l.getAttribute('data-teachers') || '').split(' ');
			l.classList.toggle('match', tid === '' || ids.indexOf(tid) >= 0);
		});
	}
	chips.forEach(function (c) {
		c.addEventListener('click', function () {
			var tid = c.getAttribute('data-teacher');
			var already = c.classList.contains('on');
			applyFilter(already ? '' : tid);
		});
	});
	applyFilter('');
})();
</script>
</body>
</html>
`;
}

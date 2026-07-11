import { describe, it, expect } from 'vitest';
import { emptyDoc, type GradeLevel, type LessonSpec, type Subject, type Teacher } from './types';
import { buildScheduleExport } from './schedule-export';
import { mapScheduleImport, parseScheduleExport } from './schedule-import';

function teacher(id: string, name: string, sn: number): Teacher {
	return { id, name, shortNumber: sn, color: '#123456', subjects: [], unavailable: [] };
}
function subject(code: string, name = code): Subject {
	return { code, name, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, teachers: string[], grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers, classes: ['1a'], grades,
		weekPattern: 'every', count, includeInSolver: true, source: 'manual', ...opts,
	};
}

/** Beispiel-Doc: normale Stunde, Kopplung (2 Specs, 1 Slot), Multi-Grade, Team-Teaching. */
function sampleDoc() {
	const doc = emptyDoc('2026/27');
	doc.teachers = [
		teacher('t-nagl', 'Nagl Tanja', 2),
		teacher('t-schlegel', 'Schlegel Georg', 3),
		teacher('t-hackl', 'Hackl Simone', 4),
	];
	doc.subjects = [subject('M', 'Mathematik'), subject('BSP', 'Bewegung und Sport'), subject('REL', 'Religion')];
	doc.specs = [
		spec('s-m', 'M', ['t-hackl'], [5], 2),
		spec('s-bspM', 'BSP', ['t-nagl'], [5, 6, 7, 8], 1, { couplingId: 'c1' }),
		spec('s-bspK', 'BSP', ['t-schlegel'], [7, 8], 1, { couplingId: 'c1' }),
		spec('s-rel', 'REL', ['t-schlegel'], [6, 7], 1),
		spec('s-team', 'M', ['t-hackl', 't-nagl'], [8], 2, {
			teachingSegments: [
				{ hours: 1, teachers: ['t-hackl', 't-nagl'] },
				{ hours: 1, teachers: ['t-hackl'] },
			],
		}),
	];
	doc.placed = [
		{ specId: 's-m', day: 'Mo', period: 1, grade: 5, pinned: false },
		{ specId: 's-m', day: 'Di', period: 2, grade: 5, pinned: true },
		// Kopplung: beide Specs am selben Slot, Mädchen-Spec über alle Stufen
		{ specId: 's-bspM', day: 'Mi', period: 3, grade: 5, pinned: false },
		{ specId: 's-bspM', day: 'Mi', period: 3, grade: 6, pinned: false },
		{ specId: 's-bspM', day: 'Mi', period: 3, grade: 7, pinned: false },
		{ specId: 's-bspM', day: 'Mi', period: 3, grade: 8, pinned: false },
		{ specId: 's-bspK', day: 'Mi', period: 3, grade: 7, pinned: false },
		{ specId: 's-bspK', day: 'Mi', period: 3, grade: 8, pinned: false },
		// Multi-Grade REL
		{ specId: 's-rel', day: 'Do', period: 4, grade: 6, pinned: false },
		{ specId: 's-rel', day: 'Do', period: 4, grade: 7, pinned: false },
		// Team-Teaching mit Segment-Team
		{ specId: 's-team', day: 'Fr', period: 1, grade: 8, pinned: false, teachers: ['t-hackl', 't-nagl'] },
		{ specId: 's-team', day: 'Fr', period: 2, grade: 8, pinned: false, teachers: ['t-hackl'] },
	];
	return doc;
}

const placedKey = (p: { specId: string; day: string; period: number; grade: number; pinned: boolean }) =>
	`${p.specId}|${p.day}|${p.period}|${p.grade}|${p.pinned}`;

describe('parseScheduleExport', () => {
	it('akzeptiert das Export-Format und normalisiert die Einträge', () => {
		const json = JSON.stringify(buildScheduleExport(sampleDoc()));
		const entries = parseScheduleExport(json);
		expect(entries).not.toBeNull();
		expect(entries!).toHaveLength(sampleDoc().placed.length);
	});

	it('lehnt kaputtes JSON und fremde Formate ab', () => {
		expect(parseScheduleExport('kein json {')).toBeNull();
		expect(parseScheduleExport('{"foo": 1}')).toBeNull();
		// JSON-Backup-Format (ScheduleDoc) hat keine placements[] → null
		expect(parseScheduleExport(JSON.stringify(emptyDoc()))).toBeNull();
		// placements vorhanden, aber kein einziger gültiger Eintrag → null
		expect(parseScheduleExport('{"placements": [{"day": "XX"}]}')).toBeNull();
	});
});

describe('mapScheduleImport', () => {
	it('Roundtrip ins selbe Doc: alle Stunden inkl. Kopplung/Multi-Grade/Pinned identisch', () => {
		const doc = sampleDoc();
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		const result = mapScheduleImport(doc, entries);
		expect(result.skipped).toEqual([]);
		expect(result.matched).toBe(entries.length);
		expect(new Set(result.placed.map(placedKey))).toEqual(new Set(doc.placed.map(placedKey)));
	});

	it('übersteht neue UUIDs (frischer Stammdaten-Import): Matching über Lehrer-Namen', () => {
		const docA = sampleDoc();
		const json = JSON.stringify(buildScheduleExport(docA));
		// Doc B: identische Daten, aber ALLE IDs neu (wie nach CSV-Re-Import).
		const docB = sampleDoc();
		const idMap = new Map<string, string>();
		for (const t of docB.teachers) {
			const nid = 'neu-' + t.id;
			idMap.set(t.id, nid);
			t.id = nid;
		}
		for (const s of docB.specs) {
			s.id = 'neu-' + s.id;
			s.teachers = s.teachers.map(id => idMap.get(id)!);
			if (s.teachingSegments) {
				s.teachingSegments = s.teachingSegments.map(seg => ({
					...seg, teachers: seg.teachers.map(id => idMap.get(id)!),
				}));
			}
		}
		docB.placed = [];

		const result = mapScheduleImport(docB, parseScheduleExport(json)!);
		expect(result.skipped).toEqual([]);
		expect(result.matched).toBe(sampleDoc().placed.length);
		// Team-Teaching-Slot: effektives Team wurde auf die NEUEN IDs gemappt.
		const teamSlot = result.placed.find(p => p.specId === 'neu-s-team' && p.period === 2);
		expect(teamSlot?.teachers).toEqual(['neu-t-hackl']);
		// Kopplung: beide Specs am Slot Mi P3 Stufe 7.
		const mi3g7 = result.placed.filter(p => p.day === 'Mi' && p.period === 3 && p.grade === 7);
		expect(new Set(mi3g7.map(p => p.specId))).toEqual(new Set(['neu-s-bspM', 'neu-s-bspK']));
	});

	it('Fallback: eindeutiger (Fach, Stufe)-Kandidat matcht auch bei umbenanntem Lehrer', () => {
		const doc = sampleDoc();
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		// Lehrer wurde inzwischen umbenannt UND hat neue ID — kein
		// Lehrer-Match mehr möglich. M/Stufe 5 hat aber nur eine Spec.
		doc.teachers[2] = teacher('t-neu', 'Neue Lehrkraft', 4);
		doc.specs.find(s => s.id === 's-m')!.teachers = ['t-neu'];
		const result = mapScheduleImport(doc, entries);
		const mSlots = result.placed.filter(p => p.specId === 's-m');
		expect(mSlots).toHaveLength(2);
		expect(result.skipped.filter(s => s.subject === 'M' && s.grade === 5)).toEqual([]);
	});

	it('KEIN Fallback bei mehreren (Fach, Stufe)-Kandidaten ohne Lehrer-Match (ambig → skip)', () => {
		const doc = sampleDoc();
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		// Beide BSP-Specs (Stufe 7) auf unbekannte Lehrer setzen → Einträge
		// für BSP/7 haben 2 Kandidaten und keinen Lehrer-Match.
		doc.teachers.push(teacher('t-x', 'Fremd Eins', 9), teacher('t-y', 'Fremd Zwei', 10));
		doc.specs.find(s => s.id === 's-bspM')!.teachers = ['t-x'];
		doc.specs.find(s => s.id === 's-bspK')!.teachers = ['t-y'];
		const result = mapScheduleImport(doc, entries);
		expect(result.skipped.some(s => s.subject === 'BSP' && (s.grade === 7 || s.grade === 8))).toBe(true);
	});

	it('Greedy pro Slot (Audit A4): zweiter Kopplungs-Eintrag fällt auf die verbleibende Spec zurück', () => {
		const doc = sampleDoc();
		// Reihenfolge-Robustheit: der später verwaiste bspK-Eintrag steht in
		// der Export-Datei VOR dem sicheren bspM-Eintrag (stabile Sortierung
		// erhält die placed-Reihenfolge) — das Ergebnis darf sich nicht ändern.
		doc.placed.reverse();
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		// Der Knaben-Lehrer wurde komplett ausgetauscht (neue ID, neuer Name)
		// → der bspK-Eintrag hat KEINEN Lehrer-Match mehr. Vorher blieb er
		// ambig hängen (2 BSP-Kandidaten an Stufe 7/8); mit Greedy ist s-bspM
		// nach dem Mädchen-Eintrag am Slot vergeben → bspK ist eindeutig.
		doc.teachers.push(teacher('t-x', 'Fremd Eins', 9));
		doc.specs.find(s => s.id === 's-bspK')!.teachers = ['t-x'];
		const result = mapScheduleImport(doc, entries);
		expect(result.skipped).toEqual([]);
		for (const grade of [7, 8] as const) {
			const atSlot = result.placed.filter(p => p.day === 'Mi' && p.period === 3 && p.grade === grade);
			expect(new Set(atSlot.map(p => p.specId))).toEqual(new Set(['s-bspM', 's-bspK']));
		}
		// matched zählt nur echte Platzierungen (kein Dedup-Schlupf mehr).
		expect(result.matched).toBe(result.placed.length);
	});

	it('weekPattern-Guard (Audit A4): Eintrag eines gelöschten G/U-Zwillings matcht NICHT den falschen Zwilling', () => {
		const doc = sampleDoc();
		doc.subjects.push(subject('BBO'));
		doc.teachers.push(teacher('t-even', 'Gerade Woche', 9), teacher('t-odd', 'Ungerade Woche', 10));
		doc.specs.push(
			spec('s-bbo-g', 'BBO', ['t-even'], [7], 1, { weekPattern: 'even' }),
			spec('s-bbo-u', 'BBO', ['t-odd'], [7], 1, { weekPattern: 'odd' }),
		);
		doc.placed.push(
			{ specId: 's-bbo-g', day: 'Fr', period: 5, grade: 7, pinned: false },
			{ specId: 's-bbo-u', day: 'Fr', period: 5, grade: 7, pinned: false },
		);
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		// Der odd-Zwilling wurde inzwischen samt Lehrer gelöscht → für seinen
		// Eintrag bleibt GENAU ein (Fach, Stufe)-Kandidat: der even-Zwilling.
		// Ohne Guard würde der Fallback ihn falsch zuordnen (Doppellage!).
		doc.specs = doc.specs.filter(s => s.id !== 's-bbo-u');
		doc.teachers = doc.teachers.filter(t => t.id !== 't-odd');
		const result = mapScheduleImport(doc, entries);
		const bboPlaced = result.placed.filter(p => p.specId.startsWith('s-bbo'));
		expect(bboPlaced).toHaveLength(1);
		expect(bboPlaced[0].specId).toBe('s-bbo-g');
		expect(result.skipped.filter(s => s.subject === 'BBO')).toHaveLength(1);
	});

	it('meldet nicht zuordenbare Einträge statt sie still zu verlieren', () => {
		const doc = sampleDoc();
		const entries = parseScheduleExport(JSON.stringify(buildScheduleExport(doc)))!;
		// Fach existiert im Ziel-Doc nicht mehr
		doc.specs = doc.specs.filter(s => s.subject !== 'REL');
		const result = mapScheduleImport(doc, entries);
		expect(result.skipped).toHaveLength(2); // REL an 2 Stufen
		expect(result.skipped.every(s => s.subject === 'REL')).toBe(true);
		expect(result.matched).toBe(entries.length - 2);
	});
});

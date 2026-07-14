import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher, type GradeLevel } from './types';
import { buildHtmlPlan, tintHex } from './html-export';

function teacher(id: string, name: string, color: string, sn: number): Teacher {
	return { id, name, shortNumber: sn, color, subjects: [], unavailable: [] };
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

function sampleDoc() {
	const doc = emptyDoc('2026/27');
	doc.teachers.push(
		teacher('tA', 'Alpha Anna', '#e11d48', 1),
		teacher('tB', 'Beta Bernd', '#2563eb', 2),
		teacher('tC', 'Chris Ohne-Stunden', '#10b981', 3),
	);
	doc.subjects.push(subject('M', 'Mathematik'), subject('BBO', 'Berufsorientierung'));
	doc.specs.push(
		spec('s1', 'M', ['tA'], [5], 2),
		spec('s2', 'BBO', ['tB'], [7], 1, { weekPattern: 'odd' }),
		spec('s3', 'M', ['tA', 'tB'], [6], 1, { teachingSegments: [{ hours: 1, teachers: ['tA', 'tB'] }] }),
	);
	doc.placed.push(
		{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false },
		{ specId: 's1', day: 'Di', period: 2, grade: 5, pinned: true },
		{ specId: 's2', day: 'Do', period: 7, grade: 7, pinned: false },
		{ specId: 's3', day: 'Fr', period: 3, grade: 6, pinned: false, teachers: ['tA', 'tB'] },
	);
	return doc;
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildHtmlPlan — Single-File-HTML-Export', () => {
	it('enthält 6 Tabs (MO–FR + FULL) und pro Tab ein Panel', () => {
		const dom = parse(buildHtmlPlan(sampleDoc()));
		const tabs = [...dom.querySelectorAll('.tab')].map(t => t.textContent?.trim());
		expect(tabs).toEqual(['MO', 'DI', 'MI', 'DO', 'FR', 'FULL']);
		const panels = [...dom.querySelectorAll('.panel')].map(p => p.getAttribute('data-panel'));
		expect(panels).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'FULL']);
		// FULL enthält alle 5 Tages-Blöcke.
		expect(dom.querySelectorAll('.fullwrap .dayblock')).toHaveLength(5);
	});

	it('Lehrer-Filter-Chips: „Alle" + nur Lehrer MIT Stunden, in App-Farben', () => {
		const dom = parse(buildHtmlPlan(sampleDoc()));
		const chips = [...dom.querySelectorAll('.chip')];
		expect(chips[0].textContent?.trim()).toBe('Alle');
		const ids = chips.slice(1).map(c => c.getAttribute('data-teacher'));
		expect(ids).toEqual(['tA', 'tB']); // tC hat keine Stunden → kein Chip
		expect(chips[1].getAttribute('style')).toContain('#e11d48');
		expect(chips[1].getAttribute('style')).toContain(tintHex('#e11d48'));
	});

	it('Stunden-Karten: Fach, L-Kürzel, G/U-Badge, Tint-Hintergrund, data-teachers', () => {
		const dom = parse(buildHtmlPlan(sampleDoc()));
		const moPanel = dom.querySelector('.panel[data-panel="Mo"]')!;
		const mo = [...moPanel.querySelectorAll('.lesson')];
		expect(mo).toHaveLength(1);
		expect(mo[0].querySelector('.subj')?.textContent).toBe('M');
		expect(mo[0].querySelector('.meta')?.textContent).toContain('L1');
		expect(mo[0].getAttribute('style')).toContain(tintHex('#e11d48'));
		expect(mo[0].getAttribute('data-teachers')).toBe('tA');
		// G/U-Badge am BBO (odd → U).
		const doPanel = dom.querySelector('.panel[data-panel="Do"]')!;
		expect(doPanel.querySelector('.lesson .wk')?.textContent).toBe('U');
		// Team-Teaching: Streifen-Gradient + beide Kürzel + beide ids.
		const frPanel = dom.querySelector('.panel[data-panel="Fr"]')!;
		const team = frPanel.querySelector('.lesson')!;
		expect(team.getAttribute('style')).toContain('linear-gradient');
		expect(team.getAttribute('data-teachers')).toBe('tA tB');
		expect(team.querySelector('.meta')?.textContent).toContain('L1 L2');
	});

	it('ist self-contained: keine externen Quellen, Skript + CSS inline', () => {
		const html = buildHtmlPlan(sampleDoc());
		expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
		expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
		expect(html).not.toMatch(/@import/i);
		expect(html).toContain('<style>');
		expect(html).toContain('<script>');
		expect(html).toContain('</html>');
	});

	it('escapt Nutzer-Strings — ein „</script>"-Fach bricht die Datei nicht', () => {
		const doc = sampleDoc();
		doc.subjects.push(subject('X', 'Böses </script><script>alert(1)'));
		doc.specs.push(spec('sx', 'X', ['tA'], [8], 1));
		doc.placed.push({ specId: 'sx', day: 'Mi', period: 4, grade: 8, pinned: false });
		const html = buildHtmlPlan(doc);
		// Es gibt genau EIN echtes schließendes Script-Tag (das Runtime-Skript).
		expect(html.match(/<\/script>/g)).toHaveLength(1);
		const dom = parse(html);
		expect(dom.querySelectorAll('script')).toHaveLength(1);
		// Der Fach-Name landet escaped im title-Attribut, nicht als Markup.
		const mi = dom.querySelector('.panel[data-panel="Mi"] .lesson');
		expect(mi?.getAttribute('title')).toContain('Böses </script>');
	});

	it('leerer Plan → lesbarer Hinweis statt leerer Seite', () => {
		const doc = emptyDoc('2026/27');
		const dom = parse(buildHtmlPlan(doc));
		expect(dom.querySelector('.empty')?.textContent).toContain('keine Stunden');
	});

	it('Titel + Legende: Schuljahr und volle Lehrer-Namen mit Farb-Punkt', () => {
		const dom = parse(buildHtmlPlan(sampleDoc()));
		expect(dom.querySelector('h1')?.textContent).toContain('2026/27');
		const legend = dom.querySelector('footer.legend')!.textContent!;
		expect(legend).toContain('Alpha Anna');
		expect(legend).toContain('Beta Bernd');
		expect(legend).not.toContain('Chris');
	});
});

describe('tintHex', () => {
	it('entspricht der 40%-Blend-Formel (weiß bleibt weiß, schwarz wird 60%-grau)', () => {
		expect(tintHex('#ffffff')).toBe('#ffffff');
		expect(tintHex('#000000')).toBe('#999999'); // 255*0.6 = 153 = 0x99
		expect(tintHex('e11d48')).toBe(tintHex('#e11d48')); // mit/ohne #
	});
});

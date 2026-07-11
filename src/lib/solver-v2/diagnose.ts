// Pre-flight diagnostics for the solver. Runs in pure TypeScript and surfaces
// the most common UNSAT causes as actionable hints.
//
// History: previously lived in src/lib/solver/diagnose.ts (the v1 MiniZinc
// solver). Phase 12 moved it into solver-v2/ so the v1 tree could be removed.
// All `spec.teachers[0]`-Compat-Shims from the v1 era are gone — diagnose
// now properly iterates over `spec.teachers` (team-teaching aware).

import type { ScheduleDoc, GradeLevel } from '../types';
import { DAYS, PERIODS } from '../types';
import { effectiveSlotCount } from '../schedule-helpers';

export interface Hint {
	severity: 'error' | 'warn';
	message: string;
}

const D = DAYS.length;
const P = PERIODS.length;

export function diagnose(doc: ScheduleDoc): Hint[] {
	const hints: Hint[] = [];

	// 1) Per-teacher load vs availability
	for (const teacher of doc.teachers) {
		const blocked = teacher.unavailable?.length ?? 0;
		const available = D * P - blocked;
		if (available <= 0) continue; // teacher has no slots at all — handled below
		// Sum hours assigned to this teacher across includeInSolver specs.
		// A team-teaching spec counts the hours for EVERY team member.
		// Audit A3: Kopplungs-Dedup pro Lehrer — zwei gekoppelte Specs
		// DESSELBEN Lehrers teilen real einen Slot (z. B. even/odd-Paar);
		// vorher wurde 2× count gezählt → falsche „überlastet"-Errors,
		// die valide Pläne als UNSAT abstempelten.
		let load = 0;
		const seenTeacherCouplings = new Set<string>();
		for (const spec of doc.specs) {
			if (spec.includeInSolver === false) continue;
			if (!spec.teachers.includes(teacher.id)) continue;
			if (spec.couplingId) {
				if (seenTeacherCouplings.has(spec.couplingId)) continue;
				seenTeacherCouplings.add(spec.couplingId);
			}
			load += effectiveSlotCount(spec);
		}
		if (load > available) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat ${load} Wochenstunden zugewiesen, aber nur ${available} verfügbare Slots (${blocked} gesperrt). Lehrer-Verfügbarkeit erweitern oder Lehreinheiten reduzieren.`
			});
		} else if (load > 0 && load > available - 4) {
			hints.push({
				severity: 'warn',
				message: `Lehrer "${teacher.name}" ist sehr eng ausgelastet: ${load}/${available} Slots. Bei zusätzlichen Constraints kann es eng werden.`
			});
		}
	}

	// 2) Teacher with 0 slots but specs assigned
	for (const teacher of doc.teachers) {
		const blocked = teacher.unavailable?.length ?? 0;
		const available = D * P - blocked;
		const hasSpecs = doc.specs.some(
			s => s.teachers.includes(teacher.id) && s.includeInSolver !== false
		);
		if (available === 0 && hasSpecs) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat keine verfügbaren Slots (alle gesperrt), aber Lehreinheiten zugewiesen. Verfügbarkeit eintragen.`
			});
		}
	}

	// 3) Grade load vs grade slots — pro Stufe darf Wochenstunden ≤ 40 sein.
	// Achtung: gekoppelte Specs (same couplingId) belegen denselben Zeit-Slot —
	// sie zählen für das Stunden-Pensum nur EINMAL pro Coupling-Gruppe.
	const gradeLoad = new Map<GradeLevel, number>();
	const seenCouplings = new Set<string>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if (spec.couplingId) {
			if (seenCouplings.has(spec.couplingId)) continue;
			seenCouplings.add(spec.couplingId);
		}
		for (const g of spec.grades) {
			gradeLoad.set(g, (gradeLoad.get(g) ?? 0) + effectiveSlotCount(spec));
		}
	}
	for (const [grade, load] of gradeLoad) {
		if (load > D * P) {
			hints.push({
				severity: 'error',
				message: `Schulstufe ${grade}. SSt. hat ${load} Wochenstunden zugewiesen, aber nur ${D * P} Slots/Woche. Stunden reduzieren oder Stufe entlasten.`
			});
		}
	}

	// 3b) Mindest-Tagespensum erfordert pro Stufe ≥ D × min_daily.
	const minDaily = doc.constraints?.minDailySlotsPerGrade ?? 0;
	if (minDaily > 0) {
		const required = D * minDaily;
		for (const [grade, load] of gradeLoad) {
			if (load < required) {
				hints.push({
					severity: 'warn',
					message: `Schulstufe ${grade}. SSt. hat nur ${load} Wochenstunden, für die Regel "≥${minDaily} Stunden pro Tag" wären mindestens ${required} nötig. Bei UNSAT lockert der Solver das Pensum automatisch.`
				});
			}
		}
	}

	// 3c) Phase 13.1 — H11 Pre-Flight: mustStartFirstPeriod ist im strict-
	// no-free-Modus quasi-hart (no_p1_start ×50). Pro Wochentag prüfen
	// ob für jede aktive Stufe genug P1-Lehrer-Kapazität existiert.
	// Wenn an einem Tag KEIN einziger Lehrer P1 hat: error (nicht warn —
	// Solver wird das nicht lockern können).
	if (doc.constraints?.mustStartFirstPeriod?.enabled && minDaily > 0) {
		const daysWithoutP1Teacher: string[] = [];
		for (let dIdx = 0; dIdx < D; dIdx++) {
			const dayName = DAYS[dIdx];
			const someoneFreeP1 = doc.teachers.some(
				t => !(t.unavailable ?? []).some(u => u.day === dayName && u.period === 1)
			);
			if (!someoneFreeP1) daysWithoutP1Teacher.push(dayName);
		}
		if (daysWithoutP1Teacher.length > 0) {
			hints.push({
				severity: 'warn',
				message: `An ${daysWithoutP1Teacher.length === 1 ? 'folgendem Wochentag' : 'folgenden Wochentagen'} ist kein Lehrer in der 1. Stunde verfügbar: ${daysWithoutP1Teacher.join(', ')}. Wenn an einem dieser Tage Stunden generiert werden, beginnt der Plan dort später — Regel "Schule beginnt P1" verletzt. Lehrer-Verfügbarkeit erweitern oder Tag akzeptieren.`
			});
		}
	}

	// 3d) Spec mit count > D und striktem Singles-Pattern → konfliktanfällig.
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const blocks = spec.blocks;
		if (!blocks || blocks.length === 0) continue;
		const allSingles = blocks.every(b => b === 1);
		if (allSingles && blocks.length > D) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit ${spec.subject} hat ${blocks.length} Einzelstunden bei nur ${D} Wochentagen. Mit dem "Doppel ⇒ kein Einzel am Tag"-Constraint ist das nicht erfüllbar. Block-Pattern auf Auto setzen oder Doppelstunden zulassen.`
			});
		}
	}

	// 4) Spec mit fehlendem Lehrer oder Subject. Nun team-aware: jeder
	// einzelne Lehrer-Eintrag muss existieren.
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const teacherIds = spec.teachers ?? [];
		if (teacherIds.length === 0) {
			hints.push({
				severity: 'error',
				message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) hat keinen Lehrer zugewiesen.`
			});
		} else {
			for (const tid of teacherIds) {
				if (!doc.teachers.find(t => t.id === tid)) {
					hints.push({
						severity: 'error',
						message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) verweist auf einen nicht existierenden Lehrer (${tid}). Bitte zuweisen.`
					});
				}
			}
		}
		if (!doc.subjects.find(s => s.code === spec.subject)) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit verwendet Fach "${spec.subject}", das in der Fächer-Liste nicht existiert. Solver verwendet einen Fallback-Index.`
			});
		}
		if (spec.grades.length === 0) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) hat keine Schulstufen — wird vom Solver übersprungen.`
			});
		}
	}

	// 5) Pinning-Konflikte: mehrere Pins auf demselben (specId, day, period, grade).
	const pinKeys = new Map<string, number>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const k = `${p.specId}|${p.day}|${p.period}|${p.grade}`;
		pinKeys.set(k, (pinKeys.get(k) ?? 0) + 1);
	}
	for (const [k, n] of pinKeys) {
		if (n > 1) {
			hints.push({
				severity: 'warn',
				message: `Mehrfach-Pin auf demselben Slot (${k}) — Duplikate werden ignoriert.`
			});
		}
	}

	// 6) Pinned-Lehrer-Slot-Kollision: zwei Pins, die denselben Lehrer am
	// selben (day, period) belegen, ohne dass sie eine Coupling teilen.
	// Team-Teaching-aware: wir prüfen jeden Team-Lehrer einzeln gegen alle
	// anderen Pins desselben Slots.
	const pinByTeacherSlot = new Map<string, { specId: string; subject: string; couplingId?: string }[]>();
	const seenSpecSlot = new Set<string>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const dedupKey = `${p.specId}|${p.day}|${p.period}`;
		if (seenSpecSlot.has(dedupKey)) continue;
		seenSpecSlot.add(dedupKey);
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		for (const tid of spec.teachers ?? []) {
			const key = `${tid}|${p.day}|${p.period}`;
			const list = pinByTeacherSlot.get(key) ?? [];
			// Skip if any prior entry shares the same couplingId — that's
			// legitimate parallel teaching.
			const sharedCoupling = list.some(
				e => e.couplingId && spec.couplingId && e.couplingId === spec.couplingId
			);
			if (sharedCoupling) continue;
			list.push({ specId: spec.id, subject: spec.subject, couplingId: spec.couplingId });
			pinByTeacherSlot.set(key, list);
		}
	}
	for (const [key, entries] of pinByTeacherSlot) {
		if (entries.length > 1) {
			const [teacherId, day, period] = key.split('|');
			const teacher = doc.teachers.find(t => t.id === teacherId);
			const subjects = entries.map(e => e.subject).join(', ');
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher?.name ?? teacherId}" ist am ${day} in der ${period}. Stunde mehrfach gepinnt (${subjects}). Pins auflösen oder gleiche Kopplungs-Gruppe vergeben.`
			});
		}
	}

	// 6b) Phase 13 — Hard-Constraint H10 (afternoonAllowed=never) Bottleneck.
	// Pro Lehrer: wieviele Vormittag-Slots (P1-P6) sind frei? Wieviele
	// 'never'-Stunden hat er zugewiesen? Wenn never-Stunden > Vormittag-Slots:
	// UNSAT durch H10 vorhersagbar — User soll vor Solver-Lauf reagieren.
	const morningPeriods = 6;
	for (const teacher of doc.teachers) {
		const blockedMorning = (teacher.unavailable ?? []).filter(u => u.period <= morningPeriods).length;
		const morningAvailable = D * morningPeriods - blockedMorning;
		let neverLoad = 0;
		for (const spec of doc.specs) {
			if (spec.includeInSolver === false) continue;
			if ((spec.afternoonAllowed ?? 'allowed') !== 'never') continue;
			if (!spec.teachers.includes(teacher.id)) continue;
			neverLoad += effectiveSlotCount(spec);
		}
		if (neverLoad > 0 && neverLoad > morningAvailable) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat ${neverLoad} Hauptfach-Stunden (Nachmittag verboten), aber nur ${morningAvailable} freie Vormittag-Slots (P1–P6, ${blockedMorning} gesperrt). Entweder Lehrer-Verfügbarkeit am Vormittag erweitern oder einzelne Lerneinheiten auf "Nachmittag erlaubt" setzen.`
			});
		}
	}

	// 6c) Phase 13 — Pro Stufe: 'never'-Stunden vs. 30 (5 Tage × 6 Vormittag).
	// Coupling-aware: gekoppelte Specs zählen einmal pro Coupling-Gruppe.
	const morningSlotsPerGrade = D * morningPeriods;
	const neverLoadByGrade = new Map<GradeLevel, number>();
	const seenCouplingsAft = new Set<string>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if ((spec.afternoonAllowed ?? 'allowed') !== 'never') continue;
		if (spec.couplingId) {
			if (seenCouplingsAft.has(spec.couplingId)) continue;
			seenCouplingsAft.add(spec.couplingId);
		}
		for (const g of spec.grades) {
			neverLoadByGrade.set(g, (neverLoadByGrade.get(g) ?? 0) + effectiveSlotCount(spec));
		}
	}
	for (const [grade, load] of neverLoadByGrade) {
		if (load > morningSlotsPerGrade) {
			hints.push({
				severity: 'error',
				message: `Schulstufe ${grade}. SSt. hat ${load} Hauptfach-Stunden (Nachmittag verboten), aber nur ${morningSlotsPerGrade} Vormittag-Slots (5 Tage × 6 Stunden). Pensum reduzieren oder Hauptfach-Markierung lockern.`
			});
		} else if (load > morningSlotsPerGrade - 4) {
			hints.push({
				severity: 'warn',
				message: `Schulstufe ${grade}. SSt. ist eng am Vormittag-Limit: ${load}/${morningSlotsPerGrade} Hauptfach-Stunden. Wenig Spielraum für andere Lerneinheiten.`
			});
		}
	}

	// 6d) Phase 13 — Pinned Hauptfach auf P7-P8.
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		if (p.period < 7) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		if ((spec.afternoonAllowed ?? 'allowed') !== 'never') continue;
		hints.push({
			severity: 'warn',
			message: `Pin auf ${p.day} ${p.period}. Stunde verletzt H10 (Hauptfach am Nachmittag, ${spec.subject}). Beim Solver-Lauf wird der Pin verworfen.`
		});
	}

	// 6e) Phase 18 — Hard-Constraint H11 ('must'): Spec MUSS nachmittags sein.
	// Pro Lehrer: wieviele Nachmittag-Slots (P7-P8) sind frei? Wieviele
	// 'must'-Stunden hat er zugewiesen? Wenn must-Stunden > Nachmittag-Slots:
	// UNSAT durch H11 vorhersagbar.
	const afternoonStart = Math.max(1, Math.min(P, Math.round(
		doc.constraints?.noMainSubjectAfternoon?.afternoonStartsAtPeriod ?? 7
	)));
	const afternoonPeriods = P - afternoonStart + 1; // P7+P8 = 2 bei Default
	for (const teacher of doc.teachers) {
		const blockedAft = (teacher.unavailable ?? []).filter(u => u.period >= afternoonStart).length;
		const aftAvailable = D * afternoonPeriods - blockedAft;
		let mustLoad = 0;
		for (const spec of doc.specs) {
			if (spec.includeInSolver === false) continue;
			if ((spec.afternoonAllowed ?? 'allowed') !== 'must') continue;
			if (!spec.teachers.includes(teacher.id)) continue;
			mustLoad += effectiveSlotCount(spec);
		}
		if (mustLoad > 0 && mustLoad > aftAvailable) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat ${mustLoad} Stunden mit "Nachmittag Pflicht", aber nur ${aftAvailable} freie Nachmittag-Slots (P${afternoonStart}–P${P}, ${blockedAft} gesperrt). Entweder Nachmittag-Verfügbarkeit erweitern oder einzelne Lerneinheiten von "Pflicht" auf "Bevorzugt" oder "Egal" setzen.`
			});
		}
	}

	// 6f) Phase 18 — Pro Stufe: 'must'-Stunden vs. afternoon-Slots-pro-Stufe.
	const aftSlotsPerGrade = D * afternoonPeriods;
	const mustLoadByGrade = new Map<GradeLevel, number>();
	const seenCouplingsMust = new Set<string>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if ((spec.afternoonAllowed ?? 'allowed') !== 'must') continue;
		if (spec.couplingId) {
			if (seenCouplingsMust.has(spec.couplingId)) continue;
			seenCouplingsMust.add(spec.couplingId);
		}
		for (const g of spec.grades) {
			mustLoadByGrade.set(g, (mustLoadByGrade.get(g) ?? 0) + effectiveSlotCount(spec));
		}
	}
	for (const [grade, load] of mustLoadByGrade) {
		if (load > aftSlotsPerGrade) {
			hints.push({
				severity: 'error',
				message: `Schulstufe ${grade}. SSt. hat ${load} "Pflicht-Nachmittag"-Stunden, aber nur ${aftSlotsPerGrade} Nachmittag-Slots (5 Tage × ${afternoonPeriods} Perioden). Plan UNSAT — Stunden reduzieren oder weniger Specs auf "Pflicht" setzen.`
			});
		} else if (load > aftSlotsPerGrade - 2) {
			hints.push({
				severity: 'warn',
				message: `Schulstufe ${grade}. SSt. ist eng am Nachmittag-Limit: ${load}/${aftSlotsPerGrade} "Pflicht-Nachmittag"-Stunden. Wenig Spielraum.`
			});
		}
	}

	// 6g) Phase 18 — Pinned 'must'-Spec auf Vormittag-Slot.
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		if (p.period >= afternoonStart) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		if ((spec.afternoonAllowed ?? 'allowed') !== 'must') continue;
		hints.push({
			severity: 'warn',
			message: `Pin auf ${p.day} ${p.period}. Stunde verletzt H11 ("Pflicht-Nachmittag", ${spec.subject}). Beim Solver-Lauf wird der Pin verworfen.`
		});
	}

	// 8) Audit A3 — Halbzahlige Stunden + Kopplungs-Konsistenz.

	// 8a) Halbzahliger count ohne G/U-Wochen-Pattern: Sokrates exportiert
	// BBO/EH als 0.5/1.5 (Wochen-Durchschnitt). Der Solver rundet auf volle
	// Slots AUF (effectiveSlotCount) — gemeint ist aber fast immer eine
	// G/U-Wochen-Stunde. Ohne Pattern belegt die Spec JEDE Woche den Slot.
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if (spec.count % 1 === 0) continue;
		if (spec.weekPattern !== 'every') continue;
		hints.push({
			severity: 'warn',
			message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) hat ${String(spec.count).replace('.', ',')} Wochenstunden OHNE G/U-Wochen-Muster — der Solver plant ${effectiveSlotCount(spec)} volle Stunde(n) jede Woche. Gemeint ist vermutlich eine G- oder U-Wochen-Stunde: im Reiter Lehreinheiten das Wochen-Muster setzen.`
		});
	}

	// 8b/8c) Kopplungs-Gruppen einsammeln und auf Konsistenz prüfen.
	const couplingGroups = new Map<string, typeof doc.specs>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if (!spec.couplingId) continue;
		const list = couplingGroups.get(spec.couplingId) ?? [];
		list.push(spec);
		couplingGroups.set(spec.couplingId, list);
	}
	for (const [, group] of couplingGroups) {
		if (group.length < 2) continue;
		// 8b) Ungleiche Slot-Zahlen: nur min(counts) Wochenstunden laufen
		// wirklich gekoppelt; der Überhang der größeren Spec läuft solo.
		const counts = group.map(s => effectiveSlotCount(s));
		const minC = Math.min(...counts);
		const maxC = Math.max(...counts);
		if (minC !== maxC) {
			const desc = group.map(s => `${s.subject} ${effectiveSlotCount(s)}h`).join(' + ');
			hints.push({
				severity: 'warn',
				message: `Kopplung ${desc}: ungleiche Stundenzahlen — nur ${minC} Stunde(n) laufen wirklich parallel, die restlichen ${maxC - minC} der größeren Lehreinheit werden UNGEKOPPELT geplant. Falls unbeabsichtigt, Stundenzahlen angleichen.`
			});
		}
		// 8c) Widersprüchliche Nachmittag-Politik: 'never' + 'must' in einer
		// Gruppe ist unerfüllbar — units.ts lässt 'never' gewinnen, die
		// 'must'-Vorgabe wird ignoriert. (Der Kommentar dort verwies bisher
		// auf eine Diagnose-Warnung, die es nicht gab — jetzt gibt es sie.)
		const hasNever = group.some(s => (s.afternoonAllowed ?? 'allowed') === 'never');
		const hasMust = group.some(s => (s.afternoonAllowed ?? 'allowed') === 'must');
		if (hasNever && hasMust) {
			hints.push({
				severity: 'warn',
				message: `Kopplung ${group.map(s => s.subject).join(' + ')}: eine Lehreinheit verbietet den Nachmittag ('nie'), eine andere erzwingt ihn ('Pflicht') — unerfüllbar. Der Solver plant die Gruppe am Vormittag ('nie' gewinnt), die Pflicht-Vorgabe wird ignoriert.`
			});
		}
	}

	// 7) Pinned-Slot-Verfügbarkeitskonflikt: Spec gepinnt aber Lehrer ist gesperrt.
	// Team-Teaching-aware: jeder Team-Lehrer muss frei sein.
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		for (const tid of spec.teachers ?? []) {
			const teacher = doc.teachers.find(t => t.id === tid);
			if (!teacher) continue;
			if (teacher.unavailable?.some(u => u.day === p.day && u.period === p.period)) {
				hints.push({
					severity: 'error',
					message: `Lehrer "${teacher.name}" ist am ${p.day} ${p.period}. Stunde als unverfügbar markiert, aber dort ist Lehreinheit ${spec.subject} gepinnt. Pin entfernen oder Verfügbarkeit anpassen.`
				});
			}
		}
	}

	return hints;
}

/** Picks the most relevant hint for the user, or null if nothing actionable. */
export function bestHint(hints: Hint[]): Hint | null {
	if (hints.length === 0) return null;
	const errors = hints.filter(h => h.severity === 'error');
	if (errors.length > 0) return errors[0];
	return hints[0];
}

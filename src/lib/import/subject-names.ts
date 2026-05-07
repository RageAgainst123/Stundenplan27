// Mapping from short subject code to full German name + sensible isMain default.
// Used by the CSV importer when creating new Subject entries; user can edit later.

export interface SubjectMeta {
	name: string;
	isMain: boolean;
}

export const SUBJECT_DEFAULTS: Record<string, SubjectMeta> = {
	M: { name: 'Mathematik', isMain: true },
	D: { name: 'Deutsch', isMain: true },
	E: { name: 'Englisch', isMain: true },
	BSP: { name: 'Bewegung und Sport', isMain: false },
	BUB: { name: 'Biologie und Umweltbildung', isMain: false },
	CH: { name: 'Chemie', isMain: false },
	PH: { name: 'Physik', isMain: false },
	GPB: { name: 'Geschichte und Politische Bildung', isMain: false },
	GWB: { name: 'Geografie und Wirtschaftliche Bildung', isMain: false },
	GZ: { name: 'Geometrisches Zeichnen', isMain: false },
	KGE: { name: 'Kunst und Gestaltung', isMain: false },
	MU: { name: 'Musik', isMain: false },
	REL: { name: 'Religion', isMain: false },
	EH: { name: 'Ernährung und Haushalt', isMain: false },
	BBO: { name: 'Berufsorientierung', isMain: false },
	TD: { name: 'Technik und Design', isMain: false },
	DGB: { name: 'Digitale Grundbildung', isMain: false },
	'FÖ': { name: 'Förderunterricht', isMain: false },
	'VS-NaSt': { name: 'Volksschul-Nahtstelle', isMain: false }
};

export function lookupSubjectMeta(code: string): SubjectMeta {
	return (
		SUBJECT_DEFAULTS[code] ?? {
			name: code,
			isMain: false
		}
	);
}

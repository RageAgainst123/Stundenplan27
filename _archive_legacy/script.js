// Lehrer-Daten mit Namen und Nummern
const teachers = [
	{ id: 1, name: 'NAGL', color: '#ff69b4' },
	{ id: 2, name: 'KOPP', color: '#90ee90' },
	{ id: 3, name: 'KOLBINGER', color: '#ffd700' },
	{ id: 4, name: 'VARGA', color: '#228b22' },
	{ id: 5, name: 'PFISTER', color: '#dc143c' },
	{ id: 6, name: 'ERTL', color: '#f5deb3' },
	{ id: 7, name: 'SLANAR', color: '#9370db' },
	{ id: 8, name: 'SCHLEGEL', color: '#87ceeb' },
	{ id: 9, name: 'SIMON', color: '#8b4513' },
	{ id: 10, name: 'HACKL', color: '#40e0d0' }
];

// Stundenplan-Daten
const scheduleData = {
	times: [
		'08:00-08:50', '08:55-09:45', '09:50-10:40', '10:55-11:45',
		'11:50-12:40', '12:45-13:35', '14:00-14:50', '14:55-15:45'
	],
	days: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'],
	grades: ['5. SSt.', '6. SSt.', '7. SSt.', '8. SSt.'],
	schedule: {
			'Montag': {
		'08:00-08:50': ['M5 (5)', 'D7 (6)', 'D 3(7)', 'M 6(8)'],
		'08:55-09:45': ['M5 (5)', 'D7 (6)', 'GPB 3(7)', 'M 6(8)'],
			'09:50-10:40': ['D7 (5)', 'M5 (6)', 'M6(7)', 'E 2(8)'],
			'10:55-11:45': ['KGE 5 (5)', 'TD 2 (6)', 'M6(7)', 'D 3(8)'],
			'11:50-12:40': ['KGE 5 (5)', 'TD 2 (6)', 'DGB 6 (7,8)', 'DGB 6 (7,8)'],
			'12:45-13:35': ['', 'GPB 4 (6)', 'GZ 6(7)', 'GWB 2(8)'],
			'14:00-14:50': ['', '', 'KGE 4(7)', 'TD 2(8)'],
			'14:55-15:45': ['', '', 'KGE 4(7)', 'TD 2(8)']
		},
		'Dienstag': {
			'08:00-08:50': ['E2 (5)', 'M5 (6)', 'D 3 (7)', 'KGE 1(8)'],
			'08:55-09:45': ['BSP1 (5)', 'GWB 2 (6)', 'BUB 10 (7)', 'D 3(8)'],
			'09:50-10:40': ['M5 (5)', 'BUB 10 (6)', 'E 4(7)', 'D 3(8)'],
			'10:55-11:45': ['D7 (5)', 'E 4 (6)', 'PH 5(7)', 'E 2(8)'],
			'11:50-12:40': ['D7 (5)', 'E 4 (6)', 'GWB 2(7)', 'PH 5(8)'],
			'12:45-13:35': ['DGB 2 (5,6)', 'DGB 2 (5,6)', 'E 4(7)', 'CH 5 (8)'],
			'14:00-14:50': ['', '', 'BBO 4 (7g)', 'BBO 4 (8u)'],
			'14:55-15:45': ['', '', '', '']
		},
		'Mittwoch': {
			'08:00-08:50': ['BUB 10 (5)', 'M5 (6)', 'E 4(7)', 'E 2(8)'],
			'08:55-09:45': ['MU 10 (5,6)', 'MU 10 (5,6)', 'E 4(7)', 'E 2(8)'],
			'09:50-10:40': ['REL 9 (5,6)', 'REL 9 (5,6)', 'PH 5(7)', 'GWB 2(8)'],
			'10:55-11:45': ['REL 9 (5,6)', 'REL 9 (5,6)', 'BSPM 1 (7)|BSPK 8 (8)', 'BSPM 1 (7)|BSPK 8 (8)'],
			'11:50-12:40': ['BSPM 1 (5)|BSPK 8 (6)', 'BSPM 1 (5)|BSPK 8 (6)', 'REL 9 (7,8)', 'REL 9 (7,8)'],
			'12:45-13:35': ['BSPM 1 (5)|BSPK 8 (6)', 'BSPM 1 (5)|BSPK 8 (6)', 'REL 9 (7,8)', 'REL 9 (7,8)'],
			'14:00-14:50': ['', '', '', ''],
			'14:55-15:45': ['', '', '', '']
		},
		'Donnerstag': {
			'08:00-08:50': ['M5 (5)', 'D7 (6)', 'D 3(7)', 'M 6(8)'],
			'08:55-09:45': ['D7 (5)', 'M5 (6)', 'D 3(7)', 'M 6(8)'],
			'09:50-10:40': ['E2 (5)', 'KGE 1 (6)', 'M6(7)', 'CH 5 (8)'],
			'10:55-11:45': ['GWB 2 (5)', 'KGE 1 (6)', 'M6(7)', 'BUB 10 (8)'],
			'11:50-12:40': ['TD 5(5)', 'BUB 10 (6)', 'GPB 3(7)', 'GZ 6(8)'],
			'12:45-13:35': ['TD 5(5)', 'EH 10 (7g)', 'EH 10 (8u)', 'GPB 3(8)'],
			'14:00-14:50': ['', 'EH 10 (7g)', 'EH 10 (8u)', ''],
			'14:55-15:45': ['', 'EH 10 (7g)', 'EH 10 (8u)', '']
		},
			'Freitag': {
		'08:00-08:50': ['E2 (5)', 'E 4 (6)', 'BSPM 1 (7)|BSPK 8 (8)', 'BSPM 1 (7)|BSPK 8 (8)'],
		'08:55-09:45': ['E2 (5)', 'E 4 (6)', 'BSPM 1 (7)|BSPK 8 (8)', 'BSPM 1 (7)|BSPK 8 (8)'],
		'09:50-10:40': ['BSPM 1 (5)|BSPK 8 (6)', 'BSPM 1 (5)|BSPK 8 (6)', 'BUB 10 (7)', 'D3 (8)'],
			'10:55-11:45': ['BUB 10 (5)', 'PH 5 (6)', 'GWB 2(7)', 'GPB 3(8)'],
			'11:50-12:40': ['GWB 2 (5)', 'D7 (6)', 'MU 5 (7,8)', 'MU 5 (7,8)'],
			'12:45-13:35': ['MU 10 (5,6)', 'MU 10 (5,6)', 'TD 5(7)', ''],
			'14:00-14:50': ['', '', 'TD 5(7)', ''],
			'14:55-15:45': ['', '', '', '']
		}
	}
};

// Globale Variablen für Filter
let selectedTeachers = new Set();
let selectedGrades = new Set();
let selectedSubject = '';
let showAllActive = true;
let currentMobileDay = 'Montag';

const weekNoteMap = { g: 'gerade Woche', u: 'ungerade Woche' };

// Funktion zum Parsen der Zellendaten
function parseCellData(cellText) {
	if (!cellText || cellText.trim() === '') {
		return { subject: '', teacher: null, grades: [], gradeDetails: [], isSplit: false };
	}

	// Prüfe auf geteilte Stunden (Format: "FACH1 LEHRER (STUFE)|FACH2 LEHRER (STUFE)")
	if (cellText.includes('|')) {
		const parts = cellText.split('|').map(part => part.trim());
		const parsedParts = parts.map(part => {
			const regex = /^([A-Z]+)\s*(\d+)\s*\(([^)]+)\)/;
			const match = part.match(regex);
			if (match) {
				const subject = match[1];
				const teacher = parseInt(match[2]);
				const gradesStr = match[3];
				const gradeDetails = gradesStr.split(',').map(g => {
					const m = g.trim().match(/(\d+)([a-z]*)/i);
					return { grade: parseInt(m[1]), note: m[2] || '' };
				});
				const grades = gradeDetails.map(g => g.grade);
				return { subject, teacher, grades, gradeDetails };
			}
			return { subject: part, teacher: null, grades: [], gradeDetails: [] };
		});

		// Kombiniere alle Grades und GradeDetails
		const allGrades = [];
		const allGradeDetails = [];
		parsedParts.forEach(part => {
			allGrades.push(...part.grades);
			allGradeDetails.push(...part.gradeDetails);
		});

		return {
			subject: parsedParts.map(p => p.subject).join('|'),
			teacher: parsedParts.map(p => p.teacher).join('|'),
			grades: allGrades,
			gradeDetails: allGradeDetails,
			isSplit: true,
			splitParts: parsedParts
		};
	}

	// Standard-Parsing für normale Stunden
	const regex = /^([A-Z]+)\s*(\d+)\s*\(([^)]+)\)/;
	const match = cellText.trim().match(regex);

	if (match) {
		const subject = match[1];
		const teacher = parseInt(match[2]);
		const gradesStr = match[3];
		const gradeDetails = gradesStr.split(',').map(g => {
			const m = g.trim().match(/(\d+)([a-z]*)/i);
			return { grade: parseInt(m[1]), note: m[2] || '' };
		});
		const grades = gradeDetails.map(g => g.grade);

		return { subject, teacher, grades, gradeDetails, isSplit: false };
	}

	return { subject: cellText, teacher: null, grades: [], gradeDetails: [], isSplit: false };
}

// Funktion zum Erstellen der Filter-Buttons
function createFilterButtons() {
	const filterContainer = document.getElementById('filterButtons');
	filterContainer.innerHTML = '';

	// "Alle anzeigen" Button
	const showAllBtn = document.createElement('button');
	showAllBtn.className = 'filter-btn show-all active';
	showAllBtn.textContent = 'Alle anzeigen';
	showAllBtn.onclick = () => toggleShowAll();
	filterContainer.appendChild(showAllBtn);

	// Lehrer-Buttons
	teachers.forEach(teacher => {
		const btn = document.createElement('button');
		btn.className = 'filter-btn teacher-chip';
		btn.textContent = `${teacher.name} ${teacher.id}`;
		btn.style.borderColor = teacher.color;
		btn.style.setProperty('--chip-color', teacher.color);
		btn.style.backgroundColor = hexToRgba(teacher.color, 0.12);
		btn.onclick = () => toggleTeacher(teacher.id);
		filterContainer.appendChild(btn);
	});
}

// Funktion zum Erstellen der Schulstufen-Filter-Buttons
function createGradeFilterButtons() {
	const gradeFilterContainer = document.getElementById('gradeFilterButtons');
	
	// Schulstufen-Buttons
	const grades = [5, 6, 7, 8];
	grades.forEach(grade => {
		const btn = document.createElement('button');
		btn.className = 'filter-btn';
		btn.textContent = `${grade}. SSt.`;
		btn.onclick = () => toggleGrade(grade);
		gradeFilterContainer.appendChild(btn);
	});
}

// Funktion zum Erstellen der Tages-Navigation
function createDayNavigation() {
	const dayTabsContainer = document.getElementById('dayTabs');
	
	scheduleData.days.forEach((day, index) => {
		const tab = document.createElement('button');
		tab.className = 'day-tab';
		tab.textContent = day.substring(0, 2); // Mo, Di, Mi, Do, Fr
		tab.dataset.day = day;
		
		// Verbesserte Event-Handler für mobile Geräte
		const handleTabClick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			console.log('Tab activated for day:', day);
			switchMobileDay(day);
		};
		
		// Mehrere Event-Types für maximale Kompatibilität
		tab.addEventListener('click', handleTabClick);
		tab.addEventListener('touchend', handleTabClick);
		tab.addEventListener('touchstart', (e) => {
			// Visuelles Feedback beim Touch
			tab.style.transform = 'scale(0.95)';
		});
		tab.addEventListener('touchcancel', (e) => {
			tab.style.transform = '';
		});
		tab.addEventListener('touchend', (e) => {
			tab.style.transform = '';
		});
		
		if (index === 0) {
			tab.classList.add('active');
		}
		
		dayTabsContainer.appendChild(tab);
	});
}

// Funktion zum Umschalten des mobilen Tages
function switchMobileDay(day) {
	console.log('=== SWITCHING TO MOBILE DAY:', day, '===');
	currentMobileDay = day;
	
	// 1. Update Tab-Status
	document.querySelectorAll('.day-tab').forEach(tab => {
		tab.classList.remove('active');
		if (tab.dataset.day === day) {
			tab.classList.add('active');
			console.log('✓ Tab activated:', tab.textContent);
		}
	});
	
	// 2. Stelle sicher, dass der Haupt-Container sichtbar ist
	const mobileContainer = document.getElementById('mobileScheduleContainer');
	if (mobileContainer) {
		mobileContainer.style.display = 'block';
		console.log('✓ Main mobile container visible');
	}
	
	// 3. Show/hide mobile day containers
	const containers = document.querySelectorAll('.mobile-day-schedule');
	console.log('Found mobile day containers:', containers.length);
	
	let foundContainer = false;
	containers.forEach(container => {
		const expectedId = `mobile-${day}`;
		if (container.id === expectedId) {
			container.style.display = 'block';
			container.style.visibility = 'visible';
			foundContainer = true;
			console.log('✓ SHOWING container:', container.id);
		} else {
			container.style.display = 'none';
			console.log('✗ Hiding container:', container.id);
		}
	});
	
	if (!foundContainer) {
		console.error('❌ ERROR: Container not found for day:', day);
		console.log('Available containers:');
		containers.forEach(c => console.log('  -', c.id));
	}
	
	// 4. Update mobile schedule display
	updateMobileScheduleDisplay();
	
	// 5. Aktuelle Stunde nach Tageswechsel erneut markieren
	highlightCurrentPeriod();
	
	console.log('=== SWITCH COMPLETE ===');
}

// Funktion zum Umschalten des "Alle anzeigen" Filters
function toggleShowAll() {
	showAllActive = !showAllActive;
	const showAllBtn = document.querySelector('.show-all');
	
	if (showAllActive) {
		showAllBtn.classList.add('active');
		selectedTeachers.clear();
		selectedGrades.clear();
		selectedSubject = '';
		// Dropdown zurücksetzen
		const select = document.getElementById('subjectFilter');
		if (select) select.selectedIndex = 0;
		document.querySelectorAll('.filter-btn:not(.show-all)').forEach(btn => {
			btn.classList.remove('active');
		});
	} else {
		showAllBtn.classList.remove('active');
	}
	
	updateCombinedDisplay();
}

// Funktion zum Umschalten eines Lehrer-Filters
function toggleTeacher(teacherId) {
	const showAllBtn = document.querySelector('.show-all');
	showAllBtn.classList.remove('active');
	showAllActive = false;

	if (selectedTeachers.has(teacherId)) {
		selectedTeachers.delete(teacherId);
	} else {
		selectedTeachers.add(teacherId);
	}

	// Update Button-Status
	document.querySelectorAll('.filter-btn:not(.show-all)').forEach(btn => {
		const btnTeacherId = parseInt(btn.textContent.split(' ').pop());
		if (selectedTeachers.has(btnTeacherId)) {
			btn.classList.add('active');
		} else {
			btn.classList.remove('active');
		}
	});

	updateCombinedDisplay();
}

// Funktion zum Umschalten eines Schulstufen-Filters
function toggleGrade(grade) {
	const showAllBtn = document.querySelector('.show-all');
	showAllBtn.classList.remove('active');
	showAllActive = false;

	if (selectedGrades.has(grade)) {
		selectedGrades.delete(grade);
	} else {
		selectedGrades.add(grade);
	}

	// Update Button-Status für Schulstufen-Buttons
	document.querySelectorAll('#gradeFilterButtons .filter-btn').forEach(btn => {
		const btnGrade = parseInt(btn.textContent.split('.')[0]);
		if (selectedGrades.has(btnGrade)) {
			btn.classList.add('active');
		} else {
			btn.classList.remove('active');
		}
	});

	updateCombinedDisplay();
}

// Funktion zum Aktualisieren der Desktop-Anzeige
function updateScheduleDisplay() {
	const cells = document.querySelectorAll('.schedule-cell');
	
	cells.forEach(cell => {
		const teacherId = cell.dataset.teacherId;
		const gradesStr = cell.dataset.grades;
		const cellGrades = gradesStr ? gradesStr.split(',').map(g => parseInt(g.trim())) : [];
		const cellSubject = cell.dataset.subject;
		
		// Lehrer-Filter prüfen (für geteilte Stunden mehrere IDs möglich)
		let teacherMatch = selectedTeachers.size === 0;
		if (!teacherMatch && teacherId) {
			const teacherIds = teacherId.includes(',') ? 
				teacherId.split(',').map(id => parseInt(id.trim())) : 
				[parseInt(teacherId)];
			teacherMatch = teacherIds.some(id => selectedTeachers.has(id));
		}
		
		// Zusätzlich prüfen: Ist ein ausgewählter Lehrer als SUP-Ersatz für diese Zelle eingetragen?
		if (!teacherMatch && selectedTeachers.size > 0) {
			teacherMatch = isTeacherSupplyingInCell(cell, selectedTeachers);
		}
		
		// Schulstufen-Filter prüfen
		const gradeMatch = selectedGrades.size === 0 || 
			(cellGrades.length > 0 && cellGrades.some(grade => selectedGrades.has(grade)));
		
		// Gegenstands-Filter prüfen (für geteilte Stunden mehrere Fächer möglich)
		let subjectMatch = selectedSubject === '';
		if (!subjectMatch && cellSubject) {
			const subjects = cellSubject.includes(',') ? 
				cellSubject.split(',').map(s => s.trim()) : 
				[cellSubject];
			subjectMatch = subjects.some(subject => subject === selectedSubject);
		}
		
		if (showAllActive || (teacherMatch && gradeMatch && subjectMatch)) {
			cell.classList.add('highlighted');
			cell.classList.remove('filtered');
		} else {
			cell.classList.add('filtered');
			cell.classList.remove('highlighted');
		}
	});
}

// Hilfsfunktion: Prüft ob ein Lehrer als SUP-Ersatz für eine bestimmte Zelle eingetragen ist
function isTeacherSupplyingInCell(cell, selectedTeachers) {
	// Ermittle Tag, Zeit und Schulstufe der Zelle
	const cellDay = getCellDay(cell);
	const cellTime = getCellTime(cell);
	const cellGradeIndex = getCellGradeIndex(cell);
	
	if (!cellDay || !cellTime || cellGradeIndex === -1) return false;
	
	// Prüfe alle SUP-Zuweisungen
	return supState.applied.some(ap => {
		return ap.day === cellDay && 
		       ap.time === cellTime && 
		       ap.gradeIndex === cellGradeIndex &&
		       selectedTeachers.has(ap.replacementId);
	});
}

// Hilfsfunktionen um Zellen-Informationen zu extrahieren
function getCellDay(cell) {
	// Finde die Tabelle und die Spalte der Zelle um den Tag zu bestimmen
	const table = cell.closest('table');
	if (!table) return null;
	
	const cellIndex = Array.from(cell.parentNode.cells).indexOf(cell);
	const headerRow = table.rows[1]; // Tag-Header-Zeile
	if (!headerRow || cellIndex >= headerRow.cells.length) return null;
	
	// Finde den Tag-Header für diese Spalte
	let colStart = 1; // Überspringe Zeit-Spalte
	for (let d = 0; d < scheduleData.days.length; d++) {
		if (cellIndex >= colStart && cellIndex < colStart + 4) {
			return scheduleData.days[d];
		}
		colStart += 4; // 4 Schulstufen pro Tag
		if (d < scheduleData.days.length - 1) colStart += 1; // Day-Gap
	}
	return null;
}

function getCellTime(cell) {
	// Finde die Zeile der Zelle um die Zeit zu bestimmen
	const row = cell.parentNode;
	const table = cell.closest('table');
	if (!table || !row) return null;
	
	const rowIndex = Array.from(table.rows).indexOf(row);
	if (rowIndex < 2) return null; // Header-Zeilen überspringen
	
	const timeIndex = rowIndex - 2; // Abzüglich der 2 Header-Zeilen
	return scheduleData.times[timeIndex] || null;
}

function getCellGradeIndex(cell) {
	// Bestimme die Schulstufe basierend auf der Position innerhalb des Tages
	const cellIndex = Array.from(cell.parentNode.cells).indexOf(cell);
	
	let colStart = 1; // Überspringe Zeit-Spalte
	for (let d = 0; d < scheduleData.days.length; d++) {
		if (cellIndex >= colStart && cellIndex < colStart + 4) {
			return cellIndex - colStart; // 0-3 für die 4 Schulstufen
		}
		colStart += 4; // 4 Schulstufen pro Tag
		if (d < scheduleData.days.length - 1) colStart += 1; // Day-Gap
	}
	return -1;
}

// Hilfsfunktion für mobile Ansicht: Prüft SUP-Zuweisungen
function isTeacherSupplyingInMobileCell(cell, selectedTeachers, currentDay) {
	// Ermittle Zeit und Schulstufe der mobilen Zelle
	const cellTime = getMobileCellTime(cell);
	const cellGradeIndex = getMobileCellGradeIndex(cell);
	
	if (!cellTime || cellGradeIndex === -1) return false;
	
	// Prüfe alle SUP-Zuweisungen für den aktuellen Tag
	return supState.applied.some(ap => {
		return ap.day === currentDay && 
		       ap.time === cellTime && 
		       ap.gradeIndex === cellGradeIndex &&
		       selectedTeachers.has(ap.replacementId);
	});
}

function getMobileCellTime(cell) {
	// Mobile Zellen sind in Zeilen organisiert, finde die Zeile
	const row = cell.parentNode;
	const table = cell.closest('table');
	if (!table || !row) return null;
	
	const rowIndex = Array.from(table.rows).indexOf(row);
	if (rowIndex < 1) return null; // Header-Zeile überspringen
	
	const timeIndex = rowIndex - 1; // Abzüglich der Header-Zeile
	return scheduleData.times[timeIndex] || null;
}

function getMobileCellGradeIndex(cell) {
	// Mobile Ansicht: Jede Spalte entspricht einer Schulstufe
	const cellIndex = Array.from(cell.parentNode.cells).indexOf(cell);
	return cellIndex >= 1 && cellIndex <= 4 ? cellIndex - 1 : -1; // 0-3 für die 4 Schulstufen
}

// Funktion zum Aktualisieren der mobilen Anzeige
function updateMobileScheduleDisplay() {
	// Selektiere nur die Zellen des aktuell sichtbaren Tages
	const currentDayContainer = document.getElementById(`mobile-${currentMobileDay}`);
	if (!currentDayContainer) return;
	
	const cells = currentDayContainer.querySelectorAll('.mobile-schedule-cell');
	
	cells.forEach(cell => {
		const teacherId = cell.dataset.teacherId;
		const gradesStr = cell.dataset.grades;
		const cellGrades = gradesStr ? gradesStr.split(',').map(g => parseInt(g.trim())) : [];
		const cellSubject = cell.dataset.subject;
		
		// Lehrer-Filter prüfen (für geteilte Stunden mehrere IDs möglich)
		let teacherMatch = selectedTeachers.size === 0;
		if (!teacherMatch && teacherId) {
			const teacherIds = teacherId.includes(',') ? 
				teacherId.split(',').map(id => parseInt(id.trim())) : 
				[parseInt(teacherId)];
			teacherMatch = teacherIds.some(id => selectedTeachers.has(id));
		}
		
		// Zusätzlich prüfen: Ist ein ausgewählter Lehrer als SUP-Ersatz für diese Zelle eingetragen?
		if (!teacherMatch && selectedTeachers.size > 0) {
			teacherMatch = isTeacherSupplyingInMobileCell(cell, selectedTeachers, currentMobileDay);
		}
		
		// Schulstufen-Filter prüfen
		const gradeMatch = selectedGrades.size === 0 || 
			(cellGrades.length > 0 && cellGrades.some(grade => selectedGrades.has(grade)));
		
		// Gegenstands-Filter prüfen (für geteilte Stunden mehrere Fächer möglich)
		let subjectMatch = selectedSubject === '';
		if (!subjectMatch && cellSubject) {
			const subjects = cellSubject.includes(',') ? 
				cellSubject.split(',').map(s => s.trim()) : 
				[cellSubject];
			subjectMatch = subjects.some(subject => subject === selectedSubject);
		}
		
		if (showAllActive || (teacherMatch && gradeMatch && subjectMatch)) {
			cell.classList.add('highlighted');
			cell.classList.remove('filtered');
		} else {
			cell.classList.add('filtered');
			cell.classList.remove('highlighted');
		}
	});
}

// Hilfsfunktion: Gap-Zelle zwischen Tagen
function createDayGapCell() {
	const gap = document.createElement('th');
	gap.className = 'day-gap';
	gap.setAttribute('aria-hidden', 'true');
	gap.textContent = '';
	return gap;
}

function createDayGapDataCell() {
	const gap = document.createElement('td');
	gap.className = 'day-gap';
	gap.setAttribute('aria-hidden', 'true');
	gap.textContent = '';
	return gap;
}

// createScheduleTable überschreiben, um Gaps einzubauen
function createScheduleTable() {
	const table = document.getElementById('scheduleTable');
	while (table.firstChild) table.removeChild(table.firstChild);
	
	// Header-Zeile mit Tagen
	const headerRow = document.createElement('tr');
	headerRow.appendChild(createHeaderCell('Zeit', 'time-column'));
	
	scheduleData.days.forEach((day, index) => {
		const dayCell = createHeaderCell(day, 'day-header');
		dayCell.colSpan = 4;
		headerRow.appendChild(dayCell);
		if (index < scheduleData.days.length - 1) {
			headerRow.appendChild(createDayGapCell());
		}
	});
	
	table.appendChild(headerRow);

	// Schulstufen-Header
	const gradeRow = document.createElement('tr');
	gradeRow.appendChild(createHeaderCell('', 'time-column'));
	
	scheduleData.days.forEach((_, dayIndex) => {
		scheduleData.grades.forEach(grade => {
			gradeRow.appendChild(createHeaderCell(grade, 'grade-header'));
		});
		if (dayIndex < scheduleData.days.length - 1) {
			gradeRow.appendChild(createDayGapCell());
		}
	});
	
	table.appendChild(gradeRow);

	// Stundenplan-Zeilen
	scheduleData.times.forEach((time, index) => {
		const timeRow = document.createElement('tr');
		const timeContent = `<span class="period-number">${index + 1}.</span><span class="period-time">${time}</span>`;
		timeRow.appendChild(createHeaderCell(timeContent, 'time-column time-cell'));
		
		scheduleData.days.forEach((day, dayIndex) => {
			const daySchedule = scheduleData.schedule[day][time] || ['', '', '', ''];
			daySchedule.forEach((cellData, gradeIndex) => {
				const cell = createScheduleCell(cellData, time, day, gradeIndex);
				timeRow.appendChild(cell);
			});
			if (dayIndex < scheduleData.days.length - 1) {
				timeRow.appendChild(createDayGapDataCell());
			}
		});
		
		table.appendChild(timeRow);
	});

	// Nach Strukturänderung neu skalieren
	requestAnimationFrame(autoscaleSchedule);
}

// Funktion zum Erstellen der mobilen Stundenplan-Tabellen
function createMobileScheduleTables() {
	const container = document.getElementById('mobileScheduleContainer');
	console.log('Creating mobile schedule tables...');
	
	// Zuerst alle existierenden Container entfernen
	container.innerHTML = '';
	
	scheduleData.days.forEach((day, index) => {
		console.log('Creating container for day:', day);
		const dayContainer = document.createElement('div');
		dayContainer.className = 'mobile-day-schedule';
		dayContainer.id = `mobile-${day}`;
		dayContainer.style.display = index === 0 ? 'block' : 'none'; // Montag (index 0) ist initial sichtbar
		
		const dayTitle = document.createElement('h2');
		dayTitle.className = 'mobile-day-title';
		dayTitle.textContent = day;
		dayContainer.appendChild(dayTitle);
		
		const table = document.createElement('table');
		table.className = 'mobile-schedule-table';
		
		// Header-Zeile
		const headerRow = document.createElement('tr');
		headerRow.appendChild(createHeaderCell('Zeit', 'mobile-time-column'));
		
		scheduleData.grades.forEach(grade => {
			headerRow.appendChild(createHeaderCell(grade, 'mobile-grade-header'));
		});
		
		table.appendChild(headerRow);
		
		// Daten-Zeilen
		scheduleData.times.forEach((time, index) => {
			const timeRow = document.createElement('tr');
			const timeContent = `<span class="period-number">${index + 1}.</span><span class="period-time">${time}</span>`;
			timeRow.appendChild(createHeaderCell(timeContent, 'mobile-time-column time-cell'));
			
			const daySchedule = scheduleData.schedule[day][time] || ['', '', '', ''];
			
			daySchedule.forEach((cellData, gradeIndex) => {
				const cell = createMobileScheduleCell(cellData, time, day, gradeIndex);
				timeRow.appendChild(cell);
			});
			
			table.appendChild(timeRow);
		});
		
		dayContainer.appendChild(table);
		container.appendChild(dayContainer);
	});
}

// Hilfsfunktion zum Erstellen von Header-Zellen
function createHeaderCell(content, className) {
	const cell = document.createElement('th');
	cell.className = className;
	cell.innerHTML = content;
	return cell;
}

// Toolbar Setup (Filter-Gruppen toggeln)
function setupToolbar() {
	const toolbar = document.createElement('div');
	toolbar.className = 'filter-toolbar';

	const toggleSubjects = document.createElement('button');
	toggleSubjects.className = 'toggle-btn';
	toggleSubjects.textContent = 'Gegenstände anzeigen';
	toggleSubjects.onclick = () => {
		const group = document.querySelector('.filter-group');
		group.classList.toggle('open');
		toggleSubjects.classList.toggle('active');
	};

	const toggleGrades = document.createElement('button');
	toggleGrades.className = 'toggle-btn';
	toggleGrades.textContent = 'Schulstufen anzeigen';
	toggleGrades.onclick = () => {
		const group = document.getElementById('gradeFilterButtons');
		group.classList.toggle('open');
		toggleGrades.classList.toggle('active');
	};

	document.querySelector('.filter-section').prepend(toolbar);
	toolbar.appendChild(toggleSubjects);
	toolbar.appendChild(toggleGrades);
}

// Gegenstände, die Schulstufen als Badges angezeigt bekommen
const subjectsWithGradeBadges = new Set(['REL', 'BSPM', 'BSPK8', 'EH', 'DGB', 'BBO']);

// Hilfsfunktion: erzeugt Markup-Fragment für eine Lesson
function buildLessonContent(parsed) {
	const wrapper = document.createElement('div');
	wrapper.className = 'lesson';

	// Geteilte Stunden (BSPM|BSPK)
	if (parsed.isSplit && parsed.splitParts) {
		wrapper.classList.add('split-lesson');
		
		parsed.splitParts.forEach((part, index) => {
			const splitSection = document.createElement('div');
			splitSection.className = 'split-section';
			
			const top = document.createElement('div');
			top.className = 'lesson-top';

			const subject = document.createElement('span');
			subject.className = 'subject-tag';
			subject.textContent = part.subject;
			top.appendChild(subject);

			if (part.teacher) {
				const teacherBadge = document.createElement('span');
				teacherBadge.className = 'teacher-badge';
				teacherBadge.textContent = 'L' + part.teacher;
				top.appendChild(teacherBadge);
			}

			splitSection.appendChild(top);

			// Schulstufen-Badges für geteilte Stunden
			if (part.gradeDetails && part.gradeDetails.length > 0 && subjectsWithGradeBadges.has(part.subject)) {
				const badges = document.createElement('div');
				badges.className = 'grade-badges';

				part.gradeDetails.forEach(gd => {
					const badge = document.createElement('span');
					badge.className = 'grade-badge';
					if (gd.note) {
						const noteMap = { g: 'gerade', u: 'ungerade' };
						badge.textContent = gd.grade + '. ' + (noteMap[gd.note] || gd.note);
					} else {
						badge.textContent = gd.grade + '.';
					}
					badges.appendChild(badge);
				});

				splitSection.appendChild(badges);
			}



			wrapper.appendChild(splitSection);
		});

		return wrapper;
	}

	// Standard-Stunden
	const top = document.createElement('div');
	top.className = 'lesson-top';

	const subject = document.createElement('span');
	subject.className = 'subject-tag';
	subject.textContent = parsed.subject;
	top.appendChild(subject);

	if (parsed.teacher) {
		const teacherBadge = document.createElement('span');
		teacherBadge.className = 'teacher-badge';
		teacherBadge.textContent = 'L' + parsed.teacher;
		top.appendChild(teacherBadge);
	}

	wrapper.appendChild(top);

	// Nur für bestimmte Gegenstände Badges für Schulstufen zeigen
	if (parsed.gradeDetails && parsed.gradeDetails.length > 0 && subjectsWithGradeBadges.has(parsed.subject)) {
		const badges = document.createElement('div');
		badges.className = 'grade-badges';

		parsed.gradeDetails.forEach(gd => {
			const badge = document.createElement('span');
			badge.className = 'grade-badge';
			if (gd.note) {
				const noteMap = { g: 'gerade', u: 'ungerade' };
				badge.textContent = gd.grade + '. ' + (noteMap[gd.note] || gd.note);
			} else {
				badge.textContent = gd.grade + '.';
			}
			badges.appendChild(badge);
		});

		wrapper.appendChild(badges);
	}

	// Spezielle g/u Kennzeichnung für BBO und EH
	if ((parsed.subject === 'BBO' || parsed.subject === 'EH') && parsed.gradeDetails && parsed.gradeDetails.length > 0) {
		const gradeDetail = parsed.gradeDetails[0];
		if (gradeDetail.note) {
			const weekBadge = document.createElement('div');
			weekBadge.className = 'week-indicator';
			
			const indicator = document.createElement('span');
			indicator.className = 'week-badge';
			indicator.textContent = gradeDetail.note.toUpperCase(); // G oder U
			weekBadge.appendChild(indicator);
			
			wrapper.appendChild(weekBadge);
		}
	}

	return wrapper;
}

// Überschreibe createScheduleCell und createMobileScheduleCell
function createScheduleCell(cellData, time, day, gradeIndex) {
	const cell = document.createElement('td');
	const parsed = parseCellData(cellData);

	if (parsed.subject === '') {
		cell.className = 'schedule-cell empty-cell';
		cell.textContent = '';
		return cell;
	}

	// Geteilte Stunden
	if (parsed.isSplit && parsed.splitParts) {
		cell.className = 'schedule-cell split-cell';
		cell.appendChild(buildLessonContent(parsed));
		
		// Setze Hintergrundfarben für geteilte Stunden (untereinander)
		const colors = parsed.splitParts
			.map(part => part.teacher ? teachers.find(t => t.id === part.teacher)?.color || '#ccc' : '#ccc')
			.filter(color => color !== '#ccc');
		
		if (colors.length === 2) {
			cell.style.backgroundImage = `linear-gradient(180deg, ${colors[0]} 0% 50%, ${colors[1]} 50% 100%)`;
		}
		
		// Datenattribute für Filter
		const teacherIds = parsed.splitParts.map(part => part.teacher).filter(id => id);
		const subjects = parsed.splitParts.map(part => part.subject);
		
		if (teacherIds.length > 0) cell.dataset.teacherId = teacherIds.join(',');
		if (parsed.grades && parsed.grades.length > 0) cell.dataset.grades = parsed.grades.join(',');
		if (subjects.length > 0) cell.dataset.subject = subjects.join(',');
		
		return cell;
	}

	// Standard-Stunden
	const teacherClass = parsed.teacher ? `teacher-${parsed.teacher}` : '';
	cell.className = `schedule-cell ${teacherClass}`;
	
	// Spezielle Behandlung für BBO und EH (halbe Zelle)
	if ((parsed.subject === 'BBO' || parsed.subject === 'EH') && parsed.gradeDetails && parsed.gradeDetails.length > 0) {
		const gradeDetail = parsed.gradeDetails[0];
		if (gradeDetail.note) { // g oder u
			cell.classList.add('half-cell');
			const teacherColor = teachers.find(t => t.id === parsed.teacher)?.color || '#ccc';
			// Halbe Zelle: links/rechts je nach gerade/ungerade Woche
			if (gradeDetail.note === 'g') {
				cell.style.backgroundImage = `linear-gradient(90deg, ${teacherColor} 0% 50%, #ffffff 50% 100%)`;
			} else {
				cell.style.backgroundImage = `linear-gradient(90deg, #ffffff 0% 50%, ${teacherColor} 50% 100%)`;
			}
		}
	}
	
	cell.appendChild(buildLessonContent(parsed));

	if (parsed.teacher) cell.dataset.teacherId = parsed.teacher;
	if (parsed.grades && parsed.grades.length > 0) cell.dataset.grades = parsed.grades.join(',');
	if (parsed.subject) cell.dataset.subject = parsed.subject;

	return cell;
}

function createMobileScheduleCell(cellData, time, day, gradeIndex) {
	const cell = document.createElement('td');
	const parsed = parseCellData(cellData);

	if (parsed.subject === '') {
		cell.className = 'mobile-schedule-cell empty-cell';
		cell.textContent = '';
		return cell;
	}

	// Geteilte Stunden
	if (parsed.isSplit && parsed.splitParts) {
		cell.className = 'mobile-schedule-cell split-cell';
		cell.appendChild(buildLessonContent(parsed));
		
		// Setze Hintergrundfarben für geteilte Stunden (untereinander)
		const colors = parsed.splitParts
			.map(part => part.teacher ? teachers.find(t => t.id === part.teacher)?.color || '#ccc' : '#ccc')
			.filter(color => color !== '#ccc');
		
		if (colors.length === 2) {
			cell.style.backgroundImage = `linear-gradient(180deg, ${colors[0]} 0% 50%, ${colors[1]} 50% 100%)`;
		}
		
		// Datenattribute für Filter
		const teacherIds = parsed.splitParts.map(part => part.teacher).filter(id => id);
		const subjects = parsed.splitParts.map(part => part.subject);
		
		if (teacherIds.length > 0) cell.dataset.teacherId = teacherIds.join(',');
		if (parsed.grades && parsed.grades.length > 0) cell.dataset.grades = parsed.grades.join(',');
		if (subjects.length > 0) cell.dataset.subject = subjects.join(',');
		
		return cell;
	}

	// Standard-Stunden
	const teacherClass = parsed.teacher ? `teacher-${parsed.teacher}` : '';
	cell.className = `mobile-schedule-cell ${teacherClass}`;
	
	// Spezielle Behandlung für BBO und EH (halbe Zelle)
	if ((parsed.subject === 'BBO' || parsed.subject === 'EH') && parsed.gradeDetails && parsed.gradeDetails.length > 0) {
		const gradeDetail = parsed.gradeDetails[0];
		if (gradeDetail.note) { // g oder u
			cell.classList.add('half-cell');
			const teacherColor = teachers.find(t => t.id === parsed.teacher)?.color || '#ccc';
			// Halbe Zelle: links/rechts je nach gerade/ungerade Woche
			if (gradeDetail.note === 'g') {
				cell.style.backgroundImage = `linear-gradient(90deg, ${teacherColor} 0% 50%, #ffffff 50% 100%)`;
			} else {
				cell.style.backgroundImage = `linear-gradient(90deg, #ffffff 0% 50%, ${teacherColor} 50% 100%)`;
			}
		}
	}
	
	cell.appendChild(buildLessonContent(parsed));

	if (parsed.teacher) cell.dataset.teacherId = parsed.teacher;
	if (parsed.grades && parsed.grades.length > 0) cell.dataset.grades = parsed.grades.join(',');
	if (parsed.subject) cell.dataset.subject = parsed.subject;

	return cell;
}

// Funktion zum Erstellen des Gegenstands-Filters
function createSubjectFilter() {
	// Schritt A: Alle Gegenstände sammeln
	const subjectsSet = new Set();
	Object.values(scheduleData.schedule).forEach(dayObj => {
		Object.values(dayObj).forEach(rowArr => {
			rowArr.forEach(cellText => {
				const parsed = parseCellData(cellText);
				if (parsed.isSplit && parsed.splitParts) {
					// Für geteilte Stunden beide Fächer hinzufügen
					parsed.splitParts.forEach(part => {
						if (part.subject) {
							subjectsSet.add(part.subject);
						}
					});
				} else if (parsed.subject) {
					subjectsSet.add(parsed.subject);
				}
			});
		});
	});
	const subjects = Array.from(subjectsSet).sort();

	// Schritt B: Dropdown referenzieren
	const select = document.getElementById('subjectFilter');
	select.innerHTML = '';

	// Schritt C: Standardoption
	const defaultOption = document.createElement('option');
	defaultOption.value = '';
	defaultOption.textContent = 'Alle Gegenstände';
	select.appendChild(defaultOption);

	// Schritt D: Optionen für alle Gegenstände
	subjects.forEach(subject => {
		const option = document.createElement('option');
		option.value = subject;
		option.textContent = subject;
		select.appendChild(option);
	});

	// Schritt E: Event-Listener
	select.onchange = handleSubjectChange;
}

function handleSubjectChange(event) {
	selectedSubject = event.target.value;
	const showAllBtn = document.querySelector('.show-all');
	showAllBtn.classList.remove('active');
	showAllActive = false;
	updateCombinedDisplay();
}

function updateCombinedDisplay() {
	updateScheduleDisplay();
	updateMobileScheduleDisplay();
}

// Mapping der Zeiten zu Start/Ende-Minuten für Highlight
function getPeriodBounds() {
	// Nutzt scheduleData.times, Format "HH:MM-HH:MM"
	return scheduleData.times.map(range => {
		const [start, end] = range.split('-');
		const [sh, sm] = start.split(':').map(n => parseInt(n, 10));
		const [eh, em] = end.split(':').map(n => parseInt(n, 10));
		return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
	});
}

// Markiere Zeitspalte derselben Periode
function markCurrentTimeColumn(periodIndex) {
	const table = document.getElementById('scheduleTable');
	if (!table) return;
	const row = table.rows[periodIndex + 2];
	if (!row) return;
	const timeHeaderCell = row.cells[0];
	if (timeHeaderCell) timeHeaderCell.classList.add('now', 'time-cell');
}

function highlightCurrentPeriod() {
	const now = new Date(); // Systemzeit (oder Mock via Konsole)
	const dayIndex = now.getDay(); // 0=So, 1=Mo, ... 5=Fr
	console.log('Checking current period - Day:', dayIndex, 'Time:', now.getHours() + ':' + now.getMinutes().toString().padStart(2, '0'));
	
	if (dayIndex < 1 || dayIndex > 5) { 
		console.log('Weekend - clearing highlights');
		clearNowHighlights(); 
		return; 
	}
	
	const minutes = now.getHours() * 60 + now.getMinutes();
	const bounds = getPeriodBounds();
	let periodIndex = -1;
	
	console.log('Current minutes since midnight:', minutes);
	console.log('Available periods:');
	bounds.forEach((bound, i) => {
		const startTime = Math.floor(bound.startMin / 60) + ':' + (bound.startMin % 60).toString().padStart(2, '0');
		const endTime = Math.floor(bound.endMin / 60) + ':' + (bound.endMin % 60).toString().padStart(2, '0');
		console.log(`  Period ${i}: ${startTime}-${endTime} (${bound.startMin}-${bound.endMin} minutes)`);
	});
	
	for (let i = 0; i < bounds.length; i++) {
		if (minutes >= bounds[i].startMin && minutes < bounds[i].endMin) { 
			periodIndex = i; 
			console.log('✓ Found current period:', i);
			break; 
		}
	}
	
	clearNowHighlights();
	if (periodIndex === -1) {
		console.log('❌ No current period - current time is between periods or outside school hours');
		return;
	}

	const dayName = scheduleData.days[dayIndex - 1];
	if (!dayName) return;

	// Desktop markieren
	const table = document.getElementById('scheduleTable');
	if (table) {
		const row = table.rows[periodIndex + 2];
		if (row) {
			let colStart = 1;
			for (let d = 0; d < scheduleData.days.length; d++) {
				if (scheduleData.days[d] === dayName) {
					for (let c = 0; c < 4; c++) {
						const cell = row.cells[colStart + c];
						if (cell && cell.classList.contains('schedule-cell')) cell.classList.add('now');
					}
					break;
				}
				colStart += 4;
				if (d < scheduleData.days.length - 1) colStart += 1;
			}
		}
	}

	// Zeitspalte hervorheben
	markCurrentTimeColumn(periodIndex);

	// Mobile markieren
	const currentDayContainer = document.getElementById(`mobile-${dayName}`);
	if (currentDayContainer && currentDayContainer.style.display !== 'none') {
		const mobileTable = currentDayContainer.querySelector('table');
		if (mobileTable) {
			const row = mobileTable.rows[periodIndex + 1];
			if (row) {
				for (let c = 1; c < row.cells.length; c++) {
					const cell = row.cells[c];
					if (cell && cell.classList.contains('mobile-schedule-cell')) cell.classList.add('now');
				}
			}
		}
	}
}

function clearNowHighlights() {
	document.querySelectorAll('.schedule-cell.now, .mobile-schedule-cell.now').forEach(el => el.classList.remove('now'));
}

let nowTimer;
function startNowTicker() {
	if (nowTimer) clearInterval(nowTimer);
	highlightCurrentPeriod();
	nowTimer = setInterval(highlightCurrentPeriod, 60 * 1000);
}

// Anpassung Autoscale: nutze scrollWidth/scrollHeight des Scale-Hosts und berücksichtige Padding
function autoscaleSchedule() {
	const container = document.querySelector('.schedule-container');
	const scaleHost = document.getElementById('scheduleScale');
	if (!container || !scaleHost) return;

	scaleHost.style.transform = 'scale(1)';

	const containerStyles = getComputedStyle(container);
	const containerPaddingX = parseFloat(containerStyles.paddingLeft) + parseFloat(containerStyles.paddingRight);
	const containerPaddingY = parseFloat(containerStyles.paddingTop) + parseFloat(containerStyles.paddingBottom);

	const availWidth = container.clientWidth - containerPaddingX - 2; // kleine Sicherheitsmarge
	const bottomGap = 16; // Sicherheitsabstand unten
	const containerTop = container.getBoundingClientRect().top;
	const availHeight = Math.max(200, window.innerHeight - containerTop - bottomGap);

	const contentWidth = scaleHost.scrollWidth;
	const contentHeight = scaleHost.scrollHeight;
	if (!contentWidth || !contentHeight) return;

	const scaleX = availWidth / contentWidth;
	const scaleY = availHeight / contentHeight;
	const scale = Math.min(scaleX, scaleY, 1);

	scaleHost.style.transform = `scale(${scale})`;
	scaleHost.style.transformOrigin = 'top center';
}

// Debounce Helper
function debounce(fn, delay) {
	let t;
	return function(...args) {
		clearTimeout(t);
		t = setTimeout(() => fn.apply(this, args), delay);
	};
}

const autoscaleScheduleDebounced = debounce(autoscaleSchedule, 50);

// Hook in Toolbar-Events, um nach Ein-/Ausblenden neu zu skalieren
function hookScaleOnPanelToggle() {
	const observer = new MutationObserver(autoscaleScheduleDebounced);
	const subjectGroup = document.querySelector('.filter-group');
	const gradeGroup = document.getElementById('gradeFilterButtons');
	if (subjectGroup) observer.observe(subjectGroup, { attributes: true, attributeFilter: ['class'] });
	if (gradeGroup) observer.observe(gradeGroup, { attributes: true, attributeFilter: ['class'] });
}

// View Controls entfernt - L und ᵍ Buttons waren überflüssig

// Hex -> rgba Hilfsfunktion für dezente Farbhintergründe
function hexToRgba(hex, alpha) {
	hex = hex.replace('#', '');
	if (hex.length === 3) {
		hex = hex.split('').map(ch => ch + ch).join('');
	}
	const r = parseInt(hex.substring(0, 2), 16);
	const g = parseInt(hex.substring(2, 4), 16);
	const b = parseInt(hex.substring(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Beim Umschalten des mobilen Tages die aktuelle Stunde erneut markieren
// (Entfernt - war kaputt und hat die Funktion überschrieben)

// Initialisierung
document.addEventListener('DOMContentLoaded', function() {
	setupToolbar();
	createFilterButtons();
	createSubjectFilter();
	createGradeFilterButtons();
	createDayNavigation();
	createScheduleTable();
	createMobileScheduleTables();
	createHeaderControls(); // Header-Controls erzeugen (nur SUP-Button)
	
	// Debug: Mobile Container Status prüfen
	console.log('Mobile containers after creation:');
	document.querySelectorAll('.mobile-day-schedule').forEach(container => {
		console.log(`Container ${container.id}: display = ${container.style.display}`);
	});
	
	// warten bis Tabelle und Mobile erstellt sind, dann skalieren
	requestAnimationFrame(async () => {
		syncUI.init();
		await loadSup(); // SUP aus Cloud/localStorage laden und anwenden
		autoscaleSchedule();
		hookScaleOnPanelToggle();
		startNowTicker();
		updateWeekInfo(); // Wochen-Info und Highlights aktualisieren
		
		// Debug: Aktuelle Zeit-Hervorhebung testen
		console.log('Now ticker started, current time highlighting should work');
		highlightCurrentPeriod(); // Zusätzlicher direkter Aufruf
	});
});

// Nach Aktionen speichern
afterSupMutation = function() { saveSupDebounced(); };

// Stelle sicher, dass nach jeder Änderung gespeichert wird
const _applySupSuggestion = applySupSuggestion;
applySupSuggestion = function(index, chosenReplacementId) { _applySupSuggestion(index, chosenReplacementId); afterSupMutation(); };

const _removeSingleSup = removeSingleSup;
removeSingleSup = function(ap) { _removeSingleSup(ap); afterSupMutation(); };

const _cancelLesson = cancelLesson;
cancelLesson = function(day, time, gradeIndex) { _cancelLesson(day, time, gradeIndex); afterSupMutation(); };

// Header-Controls (oben rechts in der Überschrift)
function createHeaderControls() {
	const header = document.querySelector('h1');
	if (!header) return;
	let controls = header.querySelector('.header-controls');
	if (controls) return;

	controls = document.createElement('div');
	controls.className = 'header-controls';

	// Wochen-Indikator
	const weekIndicator = document.createElement('div');
	weekIndicator.className = 'week-info';
	weekIndicator.id = 'week-info';
	controls.appendChild(weekIndicator);

	const btnSUP = document.createElement('button');
	btnSUP.className = 'header-toggle';
	btnSUP.title = 'SUP: Supplierungen verwalten';
	btnSUP.textContent = 'SUP';
	btnSUP.style.width = '36px';
	btnSUP.onclick = toggleSupPanel;
	controls.appendChild(btnSUP);

	header.appendChild(controls);
	
	// Wochen-Info aktualisieren
	updateWeekInfo();
}

// Wochen-Info Funktionen
function getWeekNumber(date) {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function isEvenWeek(weekNumber) {
	return weekNumber % 2 === 0;
}

function updateWeekInfo() {
	const weekInfo = document.getElementById('week-info');
	if (!weekInfo) return;
	
	const now = new Date();
	const weekNumber = getWeekNumber(now);
	const isEven = isEvenWeek(weekNumber);
	
	weekInfo.innerHTML = `
		<div class="week-display">
			<span class="week-number">KW ${weekNumber}</span>
			<span class="week-type ${isEven ? 'even' : 'odd'}">${isEven ? 'G' : 'U'}</span>
		</div>
	`;
	
	// Stunden mit entsprechender Woche hervorheben
	highlightWeekLessons(isEven);
}

function highlightWeekLessons(isEven) {
	// Entferne alle vorherigen Week-Highlights
	document.querySelectorAll('.week-badge').forEach(badge => {
		badge.classList.remove('current-week');
	});
	
	// Finde alle Wochen-Badges und markiere die der aktuellen Woche
	document.querySelectorAll('.week-badge').forEach(badge => {
		const badgeText = badge.textContent.trim();
		const isCurrentWeek = isEven ? badgeText === 'G' : badgeText === 'U';
		if (isCurrentWeek) {
			badge.classList.add('current-week');
		}
	});
}

// SUP-Daten (clientseitig)
const supState = {
	absentByDay: { Montag: new Set(), Dienstag: new Set(), Mittwoch: new Set(), Donnerstag: new Set(), Freitag: new Set() },
	suggestions: [],
	applied: [],
	assignedKeys: new Set(),
};

function toggleSupPanel() {
	let panel = document.getElementById('sup-panel');
	if (panel) { panel.remove(); autoscaleScheduleDebounced(); return; }
	panel = buildSupPanel();
	document.querySelector('h1').appendChild(panel);
}

function buildSupPanel() {
	const panel = document.createElement('div');
	panel.className = 'sup-panel';
	panel.id = 'sup-panel';
	panel.style.left = 'auto';
	panel.style.right = '8px';
	panel.style.top = '56px';

	const handle = document.createElement('div');
	handle.className = 'drag-handle';
	const ttl = document.createElement('div');
	ttl.className = 'title';
	ttl.textContent = 'SUP – Supplierungen planen';
	const btnClose = document.createElement('button');
	btnClose.className = 'close';
	btnClose.innerHTML = '×';
	btnClose.onclick = () => toggleSupPanel();
	handle.appendChild(ttl);
	handle.appendChild(btnClose);
	panel.appendChild(handle);

	// Drag-Init
	makeDraggable(panel, handle);

	// Auswahl: Lehrer krank + Tage
	const row1 = document.createElement('div');
	row1.className = 'sup-row';
	const lblTeacher = document.createElement('label');
	lblTeacher.textContent = 'Lehrer (krank):';
	const selTeacher = document.createElement('select');
	selTeacher.id = 'sup-teacher';
	teachers.forEach(t => {
		const opt = document.createElement('option');
		opt.value = t.id;
		opt.textContent = `${t.name} ${t.id}`;
		selTeacher.appendChild(opt);
	});
	row1.appendChild(lblTeacher);
	row1.appendChild(selTeacher);
	panel.appendChild(row1);

	const rowDays = document.createElement('div');
	rowDays.className = 'sup-row';
	const lblDays = document.createElement('label');
	lblDays.textContent = 'Tage:';
	const daysWrap = document.createElement('div');
	daysWrap.className = 'sup-days';
	scheduleData.days.forEach(d => {
		const lab = document.createElement('label');
		const cb = document.createElement('input');
		cb.type = 'checkbox'; cb.value = d;
		lab.appendChild(cb); lab.appendChild(document.createTextNode(d));
		daysWrap.appendChild(lab);
	});
	rowDays.appendChild(lblDays);
	rowDays.appendChild(daysWrap);
	panel.appendChild(rowDays);

	const actions = document.createElement('div');
	actions.className = 'sup-actions';
	const btnSuggest = document.createElement('button');
	btnSuggest.className = 'sup-btn primary';
	btnSuggest.textContent = 'Vorschläge finden';
	btnSuggest.onclick = () => runSupSuggestions(parseInt(selTeacher.value,10), getCheckedDays(daysWrap));
	const btnClear = document.createElement('button');
	btnClear.className = 'sup-btn';
	btnClear.textContent = 'Zurücksetzen';
	btnClear.onclick = resetSup;
	actions.appendChild(btnClear);
	actions.appendChild(btnSuggest);
	panel.appendChild(actions);

	const list = document.createElement('div');
	list.className = 'sup-list';
	list.id = 'sup-list';
	panel.appendChild(list);

	return panel;
}

function makeDraggable(panel, handle) {
	panel.style.position = 'fixed';
	let startX=0, startY=0, startLeft=0, startTop=0, dragging=false;
	handle.addEventListener('mousedown', e => {
		dragging = true; startX = e.clientX; startY = e.clientY;
		const rect = panel.getBoundingClientRect(); startLeft = rect.left; startTop = rect.top;
		document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
	});
	function onMove(e){ if(!dragging) return; const dx=e.clientX-startX, dy=e.clientY-startY; panel.style.left = `${startLeft+dx}px`; panel.style.top = `${Math.max(0,startTop+dy)}px`; panel.style.right='auto'; }
	function onUp(){ dragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
}

function getCheckedDays(container) {
	return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function resetSup() {
	supState.suggestions = [];
	supState.applied = [];
	supState.assignedKeys.clear(); // Zugewiesene Slots zurücksetzen
	Object.keys(supState.absentByDay).forEach(d => supState.absentByDay[d].clear());
	refreshSupView();
	updateCombinedDisplay();
	autoscaleScheduleDebounced();
}

function runSupSuggestions(absentTeacherId, days) {
	// Absenzen merken
	days.forEach(d => supState.absentByDay[d].add(absentTeacherId));

	const suggestions = [];
	days.forEach(day => {
		const daySchedule = scheduleData.schedule[day];
		Object.entries(daySchedule).forEach(([time, cells]) => {
			cells.forEach((cellText, gradeIndex) => {
				const parsed = parseCellData(cellText);
				
				// Für geteilte Stunden prüfen, ob einer der Lehrer abwesend ist
				if (parsed.isSplit && parsed.splitParts) {
					const affectedPart = parsed.splitParts.find(part => part.teacher === absentTeacherId);
					if (affectedPart) {
						const periodIndex = scheduleData.times.indexOf(time);
						const subjectCode = affectedPart.subject || '';
						// Kandidaten finden + bewerten
						const candidateIds = teachers
							.map(t => t.id)
							.filter(id => id !== absentTeacherId)
							.filter(id => isTeacherFree(id, day, time))
							.filter(id => isTeacherPresentThatDay(id, day));
						const ranked = candidateIds
							.map(id => ({ id, score: computeGapScore(id, day, periodIndex) }))
							.sort((a,b) => a.score - b.score);
						if (ranked.length > 0) {
							const bestId = ranked[0].id;
							suggestions.push({ 
								day, time, periodIndex, gradeIndex, subjectCode, absentTeacherId, 
								replacementId: bestId, candidates: ranked.map(r => r.id), 
								isSplitLesson: true, affectedPart: affectedPart 
							});
						}
					}
				} else if (parsed.teacher === absentTeacherId) {
					const periodIndex = scheduleData.times.indexOf(time);
					const subjectCode = parsed.subject || '';
					// Kandidaten finden + bewerten
					const candidateIds = teachers
						.map(t => t.id)
						.filter(id => id !== absentTeacherId)
						.filter(id => isTeacherFree(id, day, time))
						.filter(id => isTeacherPresentThatDay(id, day));
					const ranked = candidateIds
						.map(id => ({ id, score: computeGapScore(id, day, periodIndex) }))
						.sort((a,b) => a.score - b.score);
					if (ranked.length > 0) {
						const bestId = ranked[0].id;
						suggestions.push({ day, time, periodIndex, gradeIndex, subjectCode, absentTeacherId, replacementId: bestId, candidates: ranked.map(r => r.id) });
					}
				}
			});
		});
	});
	supState.suggestions = suggestions;
	refreshSupView();
}

function isTeacherFree(teacherId, day, time) {
	// Belegte Slots aus Originalplan
	const cells = scheduleData.schedule[day][time] || [];
	for (const cellText of cells) {
		const p = parseCellData(cellText);
		if (p.isSplit && p.splitParts) {
			// Für geteilte Stunden alle Lehrer prüfen
			if (p.splitParts.some(part => part.teacher === teacherId)) return false;
		} else if (p.teacher === teacherId) {
			return false;
		}
	}
	// Bereits vergebene SUP blockieren denselben Slot für diesen Lehrer
	for (const ap of supState.applied) {
		if (ap.day === day && ap.time === time && ap.replacementId === teacherId) return false;
	}
	return true;
}

function isTeacherPresentThatDay(teacherId, day) {
	const daySchedule = scheduleData.schedule[day];
	return Object.values(daySchedule).some(cells => cells.some(cellText => {
		const p = parseCellData(cellText);
		if (p.isSplit && p.splitParts) {
			return p.splitParts.some(part => part.teacher === teacherId);
		}
		return p.teacher === teacherId;
	}));
}

function refreshSupView() {
	const list = document.getElementById('sup-list');
	if (list) {
		list.innerHTML = '';
		supState.suggestions.forEach((sug, idx) => {
			const box = document.createElement('div'); box.className = 'sup-slot';
			const title = document.createElement('div'); title.className = 'sup-slot-title';
			const periodLabel = `${sug.periodIndex + 1}. Stunde ${sug.time}`;
			const gradeLabel = scheduleData.grades[sug.gradeIndex];
			title.textContent = `${sug.day} – ${periodLabel} – ${gradeLabel} – ${sug.subjectCode}`;
			box.appendChild(title);

			const select = document.createElement('select');
			(sug.candidates || []).forEach(id => {
				const opt = document.createElement('option');
				opt.value = id;
				opt.textContent = buildCandidateLabelWithStatus(id, sug.day, sug.periodIndex);
				if (id === sug.replacementId) opt.selected = true;
				select.appendChild(opt);
			});
			// Alle anderen Lehrer (auch nicht verfügbar) ergänzen
			teachers.forEach(t => {
				if ((sug.candidates || []).includes(t.id)) return;
				const opt = document.createElement('option');
				opt.value = t.id;
				opt.textContent = buildCandidateLabelWithStatus(t.id, sug.day, sug.periodIndex);
				select.appendChild(opt);
			});
			box.appendChild(select);

			const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.marginTop = '6px';
			const applyBtn = document.createElement('button'); applyBtn.className = 'sup-btn primary'; applyBtn.textContent = 'Übernehmen';
			const cancelBtn = document.createElement('button'); cancelBtn.className = 'sup-btn warn'; cancelBtn.textContent = 'Entfällt';
			const slotKey = `${sug.day}|${sug.time}|${sug.gradeIndex}`;
			if (supState.assignedKeys.has(slotKey)) { applyBtn.disabled = true; select.disabled = true; cancelBtn.disabled = true; applyBtn.textContent = 'Zugewiesen'; }
			applyBtn.onclick = () => applySupSuggestion(idx, parseInt(select.value,10));
			cancelBtn.onclick = () => { cancelLesson(sug.day, sug.time, sug.gradeIndex); refreshSupView(); };
			actions.appendChild(cancelBtn);
			actions.appendChild(applyBtn);
			box.appendChild(actions);

			list.appendChild(box);
		});
	}
	updateCombinedDisplay();
	applySupDecorationsToDOM();
	autoscaleScheduleDebounced();
}

function applySupSuggestion(index, chosenReplacementId) {
	const sug = supState.suggestions[index];
	if (!sug) return;
	const slotKey = `${sug.day}|${sug.time}|${sug.gradeIndex}`;
	if (supState.assignedKeys.has(slotKey)) return; // schon vergeben
	supState.assignedKeys.add(slotKey);
	// Merken, dass für diesen Slot ein Ersatzlehrer gewählt wurde
	supState.applied.push({ ...sug, replacementId: chosenReplacementId });
	refreshSupView();
}

// Gap-Score: kleinere Werte sind besser (weniger Freistunden um den Slot herum)
function computeGapScore(teacherId, day, periodIndex) {
	const bounds = getPeriodBounds();
	const current = bounds[periodIndex];
	const teacherPeriods = getTeacherPeriods(teacherId, day);
	let prevIdx = -1, nextIdx = -1;
	for (let i = teacherPeriods.length - 1; i >= 0; i--) { if (teacherPeriods[i] < periodIndex) { prevIdx = teacherPeriods[i]; break; } }
	for (let i = 0; i < teacherPeriods.length; i++) { if (teacherPeriods[i] > periodIndex) { nextIdx = teacherPeriods[i]; break; } }
	let gapBefore = 90; // große Strafe wenn kein vorheriger Unterricht
	let gapAfter = 90;
	if (prevIdx !== -1) gapBefore = Math.max(0, current.startMin - bounds[prevIdx].endMin);
	if (nextIdx !== -1) gapAfter = Math.max(0, bounds[nextIdx].startMin - current.endMin);
	// Bonus wenn direkt angrenzend (0 Gap)
	const adjacencyBonus = (gapBefore === 0 ? -10 : 0) + (gapAfter === 0 ? -10 : 0);
	return gapBefore + gapAfter + adjacencyBonus;
}

function getTeacherPeriods(teacherId, day) {
	const indices = [];
	const bounds = getPeriodBounds();
	const daySchedule = scheduleData.schedule[day];
	scheduleData.times.forEach((time, idx) => {
		const cells = daySchedule[time] || [];
		for (const cellText of cells) {
			const p = parseCellData(cellText);
			if (p.isSplit && p.splitParts) {
				if (p.splitParts.some(part => part.teacher === teacherId)) { 
					indices.push(idx); 
					break; 
				}
			} else if (p.teacher === teacherId) { 
				indices.push(idx); 
				break; 
			}
		}
	});
	return indices.sort((a,b)=>a-b);
}

function applySupDecorationsToDOM() {
	// Entferne vorherige SUP-Markierungen
	document.querySelectorAll('.schedule-cell.sup-applied .sup-badge, .schedule-cell.sup-applied .absent-badge').forEach(b => b.remove());
	document.querySelectorAll('.schedule-cell.sup-applied').forEach(c => { 
		c.classList.remove('sup-applied'); 
		c.style.backgroundImage = ''; 
		c.style.position = ''; // Position zurücksetzen
	});

	supState.applied.forEach(ap => {
		const { day, time, gradeIndex, absentTeacherId, replacementId, subjectCode, periodIndex, isSplitLesson, affectedPart } = ap;
		const table = document.getElementById('scheduleTable');
		if (!table) return;
		const row = Array.from(table.rows)[scheduleData.times.indexOf(time) + 2];
		if (!row) return;
		let colStart = 1;
		for (let d = 0; d < scheduleData.days.length; d++) {
			if (scheduleData.days[d] === day) {
				const cell = row.cells[colStart + gradeIndex];
				if (!cell) break;
				cell.classList.add('sup-applied');
				
				// Für geteilte Stunden: nur den betroffenen Teil ersetzen
				if (isSplitLesson && affectedPart) {
					// Hole die ursprünglichen Daten der Zelle
					const cellData = scheduleData.schedule[day][time][gradeIndex];
					const originalParsed = parseCellData(cellData);
					
					if (originalParsed.isSplit && originalParsed.splitParts) {
						const colors = originalParsed.splitParts.map(part => {
							// Wenn dieser Teil der abwesende Lehrer ist, verwende Ersatzlehrer-Farbe
							if (part.teacher === absentTeacherId) {
								return teachers.find(t => t.id === replacementId)?.color || '#ccc';
							}
							// Sonst verwende ursprüngliche Farbe
							return teachers.find(t => t.id === part.teacher)?.color || '#ccc';
						});
						
						if (colors.length === 2) {
							cell.style.backgroundImage = `linear-gradient(180deg, ${colors[0]} 0% 50%, ${colors[1]} 50% 100%)`;
						}
					}
				} else {
					// Standard-Supplierung (nicht geteilte Stunde)
					const absentColor = (teachers.find(t => t.id === absentTeacherId)?.color) || '#999';
					const replColor = (teachers.find(t => t.id === replacementId)?.color) || '#ccc';
					cell.style.backgroundImage = `linear-gradient(180deg, ${absentColor} 0 50%, ${replColor} 50% 100%)`;
				}
				
				// Verbesserte SUP-Darstellung: "SUP" beim Ersatzlehrer, "X" beim abwesenden Lehrer
				if (isSplitLesson && affectedPart !== undefined) {
					addSupBadgesToSplitCell(cell, absentTeacherId, replacementId, affectedPart);
				} else {
					addSupBadgesToNormalCell(cell, absentTeacherId, replacementId);
				}
				break;
			}
			colStart += 4; if (d < scheduleData.days.length - 1) colStart += 1;
		}
	});

	updateSupSummary();
	
	// Filter-Anzeige aktualisieren, damit SUP-Stunden korrekt angezeigt werden
	updateScheduleDisplay();
	updateMobileScheduleDisplay();
}

function addSupBadgesToNormalCell(cell, absentTeacherId, replacementId) {
	// X-Badge für abwesenden Lehrer (obere Hälfte)
	const absentBadge = document.createElement('span');
	absentBadge.className = 'absent-badge';
	absentBadge.textContent = 'X';
	absentBadge.style.cssText = `
		position: absolute;
		top: 20%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10;
	`;
	
	// SUP-Badge für Ersatzlehrer (untere Hälfte)
	const supBadge = document.createElement('span');
	supBadge.className = 'sup-badge';
	supBadge.textContent = 'SUP';
	supBadge.style.cssText = `
		position: absolute;
		bottom: 20%;
		left: 50%;
		transform: translate(-50%, 50%);
		z-index: 10;
	`;
	
	// Zelle relativ positionieren für absolute Badges
	cell.style.position = 'relative';
	cell.appendChild(absentBadge);
	cell.appendChild(supBadge);
}

function addSupBadgesToSplitCell(cell, absentTeacherId, replacementId, affectedPart) {
	// Bestimme welcher Teil betroffen ist (oberer oder unterer)
	const isTopHalfAffected = affectedPart === 0;
	
	if (isTopHalfAffected) {
		// Obere Hälfte: X für abwesenden Lehrer (oben), SUP für Ersatzlehrer (oben)
		const absentBadge = document.createElement('span');
		absentBadge.className = 'absent-badge';
		absentBadge.textContent = 'X';
		absentBadge.style.cssText = `
			position: absolute;
			top: 12%;
			left: 50%;
			transform: translate(-50%, -50%);
			z-index: 10;
		`;
		
		const supBadge = document.createElement('span');
		supBadge.className = 'sup-badge';
		supBadge.textContent = 'SUP';
		supBadge.style.cssText = `
			position: absolute;
			top: 35%;
			left: 50%;
			transform: translate(-50%, -50%);
			z-index: 10;
		`;
		
		cell.style.position = 'relative';
		cell.appendChild(absentBadge);
		cell.appendChild(supBadge);
	} else {
		// Untere Hälfte: X für abwesenden Lehrer (unten), SUP für Ersatzlehrer (unten)
		const absentBadge = document.createElement('span');
		absentBadge.className = 'absent-badge';
		absentBadge.textContent = 'X';
		absentBadge.style.cssText = `
			position: absolute;
			bottom: 35%;
			left: 50%;
			transform: translate(-50%, 50%);
			z-index: 10;
		`;
		
		const supBadge = document.createElement('span');
		supBadge.className = 'sup-badge';
		supBadge.textContent = 'SUP';
		supBadge.style.cssText = `
			position: absolute;
			bottom: 12%;
			left: 50%;
			transform: translate(-50%, 50%);
			z-index: 10;
		`;
		
		cell.style.position = 'relative';
		cell.appendChild(absentBadge);
		cell.appendChild(supBadge);
	}
}

function updateSupSummary() {
	const wrap = document.getElementById('supSummary');
	if (!wrap) return;
	wrap.innerHTML = '';
	const header = document.createElement('div');
	header.className = 'sup-summary-header';
	const h = document.createElement('h4'); h.textContent = 'Supplierungen';
	const actions = document.createElement('div'); actions.className = 'summary-actions';
	const btnPrint = document.createElement('button'); btnPrint.className = 'summary-btn'; btnPrint.textContent = 'Drucken'; btnPrint.onclick = () => window.print();
	const btnPrintSupOnly = document.createElement('button'); btnPrintSupOnly.className = 'summary-btn primary'; btnPrintSupOnly.textContent = 'Nur SUP drucken'; btnPrintSupOnly.onclick = () => { document.body.classList.add('print-sup-only'); window.print(); setTimeout(()=>document.body.classList.remove('print-sup-only'), 1000); };
	const btnDownload = document.createElement('button'); btnDownload.className = 'summary-btn'; btnDownload.textContent = 'Als Text speichern'; btnDownload.onclick = downloadSupAsText;
	actions.appendChild(btnPrint); actions.appendChild(btnPrintSupOnly); actions.appendChild(btnDownload);
	header.appendChild(h); header.appendChild(actions);
	wrap.appendChild(header);

	if (supState.applied.length === 0) {
		const empty = document.createElement('div'); empty.className = 'sup-item'; empty.textContent = 'Keine Supplierungen'; wrap.appendChild(empty); return;
	}

	// Gruppiere nach Tag
	const byDay = new Map();
	supState.applied.forEach(ap => {
		if (!byDay.has(ap.day)) byDay.set(ap.day, []);
		byDay.get(ap.day).push(ap);
	});

	Array.from(byDay.keys()).sort((a,b)=>scheduleData.days.indexOf(a)-scheduleData.days.indexOf(b)).forEach(day => {
		const section = document.createElement('div'); section.className = 'sup-summary-day';
		const dh = document.createElement('h5'); dh.textContent = day; section.appendChild(dh);
		const gridHeader = document.createElement('div'); gridHeader.className = 'sup-grid header';
		['Stunde','Zeit','Schulstufe','Fach','Einspringer','Ausfall'].forEach(t => {
			const c = document.createElement('div'); c.className = 'cell'; c.textContent = t; gridHeader.appendChild(c);
		});
		const ch = document.createElement('div'); ch.className = 'cell actions'; ch.textContent = 'Aktion'; gridHeader.appendChild(ch);
		section.appendChild(gridHeader);

		byDay.get(day)
			.sort((a,b)=>a.periodIndex-b.periodIndex)
			.forEach(ap => {
				const grid = document.createElement('div'); grid.className = 'sup-grid';
				const absent = teachers.find(t => t.id === ap.absentTeacherId);
				const repl = teachers.find(t => t.id === ap.replacementId);
				const cells = [
					`${ap.periodIndex+1}.`,
					ap.time,
					scheduleData.grades[ap.gradeIndex],
					ap.subjectCode,
					repl?.name || '',
					absent?.name || ''
				];
				cells.forEach(val => { const c = document.createElement('div'); c.className = 'cell'; c.textContent = val; grid.appendChild(c); });
				const actions = document.createElement('div'); actions.className = 'cell actions';
				const removeBtn = document.createElement('button'); removeBtn.className = 'sup-btn warn'; removeBtn.textContent = 'Entfernen'; removeBtn.onclick = () => removeSingleSup(ap);
				actions.appendChild(removeBtn);
				grid.appendChild(actions);
				section.appendChild(grid);
			});
		wrap.appendChild(section);
	});
}

// SUP-Panel: Status-Info je Lehrer-Kandidat
function buildCandidateLabelWithStatus(teacherId, day, periodIndex) {
	const t = teachers.find(tt => tt.id === teacherId);
	if (!t) return '';
	let status = '';
	const periods = getTeacherPeriods(teacherId, day);
	if (periods.length === 0) status = 'kein Unterricht am Tag';
	else {
		const before = periods.filter(p => p < periodIndex).pop();
		const after = periods.find(p => p > periodIndex);
		if (before === undefined && after === undefined) status = 'frei';
		else if (before !== undefined && after === undefined) status = 'Unterricht vorher';
		else if (before === undefined && after !== undefined) status = 'Unterricht später';
		else status = 'Unterricht davor & danach';
	}
	return `${t.name} – ${status}`;
}

function downloadSupAsText() {
	const lines = supState.applied.map(ap => {
		const gradeLabel = scheduleData.grades[ap.gradeIndex];
		const absent = teachers.find(t => t.id === ap.absentTeacherId);
		const repl = teachers.find(t => t.id === ap.replacementId);
		return `${ap.day} – ${ap.periodIndex+1}. Stunde ${ap.time} – ${gradeLabel} – ${ap.subjectCode}: ${repl?.name} ${repl?.id} für ${absent?.name} ${absent?.id}`;
	});
	const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a'); a.href = url; a.download = 'supplierungen.txt'; a.click(); URL.revokeObjectURL(url);
}

// Unterricht entfallen lassen (kein SUP nötig)
function cancelLesson(day, time, gradeIndex) {
	// Entferne existierende SUP für diesen Slot
	supState.applied = supState.applied.filter(x => !(x.day === day && x.time === time && x.gradeIndex === gradeIndex));
	supState.assignedKeys.add(`${day}|${time}|${gradeIndex}`); // blockiere Slot
	// Zelle im DOM neutral grau markieren und Badge anhängen
	const table = document.getElementById('scheduleTable');
	if (table) {
		const row = Array.from(table.rows)[scheduleData.times.indexOf(time) + 2];
		let colStart = 1;
		for (let d = 0; d < scheduleData.days.length; d++) {
			if (scheduleData.days[d] === day) {
				const cell = row.cells[colStart + gradeIndex]; if (!cell) break;
				cell.classList.add('canceled-cell');
				const badge = document.createElement('span'); badge.className = 'cancel-badge'; badge.textContent = 'ENTFÄLLT';
				const top = cell.querySelector('.lesson-top') || cell.firstChild; if (top) top.appendChild(badge); else cell.appendChild(badge);
				break;
			}
			colStart += 4; if (d < scheduleData.days.length - 1) colStart += 1;
		}
	}
	updateSupSummary();
}

function removeSingleSup(ap) {
	// Entfernt einen Eintrag und aktualisiert Darstellung/Locks
	supState.applied = supState.applied.filter(x => !(x.day === ap.day && x.time === ap.time && x.gradeIndex === ap.gradeIndex));
	supState.assignedKeys.delete(`${ap.day}|${ap.time}|${ap.gradeIndex}`);
	applySupDecorationsToDOM();
	refreshSupView();
} 

// ===== SUP Persistenz: Cloud (JSONBin) oder localStorage =====
const CLOUD_SUP = {
	provider: 'jsonbin',
	BIN_ID: '689cddaed0ea881f40588d04',
	API_KEY: '$2a$10$7hoR2ze7YtrsAEg6Sg0w9.fBtfDeVgXllHPdlM5oXK7CPsKGnA/4C'
};

function serializeSupState() {
	return {
		applied: supState.applied,
		assignedKeys: Array.from(supState.assignedKeys || []),
		canceled: supState.canceled || []
	};
}

function applyLoadedSupState(data) {
	if (!data) return;
	supState.applied = Array.isArray(data.applied) ? data.applied : [];
	supState.assignedKeys = new Set(Array.isArray(data.assignedKeys) ? data.assignedKeys : []);
	supState.canceled = Array.isArray(data.canceled) ? data.canceled : [];
	applySupDecorationsToDOM();
	applyCanceledToDOM();
	updateSupSummary();
}

async function loadSup() {
	try {
		if (CLOUD_SUP.provider === 'jsonbin' && CLOUD_SUP.BIN_ID && CLOUD_SUP.API_KEY) {
			const r = await fetch(`https://api.jsonbin.io/v3/b/${CLOUD_SUP.BIN_ID}/latest`, {
				headers: { 'X-Master-Key': CLOUD_SUP.API_KEY }
			});
			if (r.ok) {
				const data = (await r.json()).record;
				applyLoadedSupState(data);
				return;
			}
		}
		// Fallback: localStorage
		const raw = localStorage.getItem('supState');
		if (raw) applyLoadedSupState(JSON.parse(raw));
	} catch (e) {
		console.warn('SUP laden fehlgeschlagen', e);
	}
}

async function saveSup() {
	try {
		const data = serializeSupState();
		// localStorage Always
		localStorage.setItem('supState', JSON.stringify(data));
		// Cloud optional
		if (CLOUD_SUP.provider === 'jsonbin' && CLOUD_SUP.BIN_ID && CLOUD_SUP.API_KEY) {
			await fetch(`https://api.jsonbin.io/v3/b/${CLOUD_SUP.BIN_ID}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'X-Master-Key': CLOUD_SUP.API_KEY },
				body: JSON.stringify(data)
			});
		}
	} catch (e) {
		console.warn('SUP speichern fehlgeschlagen', e);
	}
}

const saveSupDebounced = debounce(saveSup, 200);

// Sync-Status Anzeige
const syncUI = {
	el: null, dot: null, text: null,
	mobileEl: null, mobileDot: null, mobileText: null,
	init() {
		this.el = document.getElementById('syncIndicator');
		this.dot = document.getElementById('syncDot');
		this.text = document.getElementById('syncText');
		this.mobileEl = document.querySelector('.mobile-sync-indicator .sync-indicator');
		this.mobileDot = document.getElementById('mobileSyncDot');
		this.mobileText = document.getElementById('mobileSyncText');
		console.log('SyncUI init:', {
			desktop: !!this.el,
			mobile: !!this.mobileEl,
			mobileDot: !!this.mobileDot,
			mobileText: !!this.mobileText
		});
		this.updateSourceLabel();
	},
	updateSourceLabel() {
		const usesCloud = CLOUD_SUP.provider === 'jsonbin' && CLOUD_SUP.BIN_ID && CLOUD_SUP.API_KEY;
		const isOnline = usesCloud;
		this.setIdle(isOnline ? 'Online (Cloud)' : 'Offline (lokal)');
		if (this.el) this.el.className = `sync-indicator ${isOnline ? 'ok' : 'err'}`;
		if (this.dot) this.dot.className = `sync-dot ${isOnline ? 'ok' : 'err'}`;
		if (this.mobileEl) this.mobileEl.className = `sync-indicator ${isOnline ? 'ok' : 'err'}`;
		if (this.mobileDot) this.mobileDot.className = `sync-dot ${isOnline ? 'ok' : 'err'}`;
	},
	setSaving(msg='Synchronisiere...') { 
		if (this.el) { this.el.className='sync-indicator saving'; this.dot.className='sync-dot saving'; this.text.textContent = msg; }
		if (this.mobileEl) { this.mobileEl.className='sync-indicator saving'; this.mobileDot.className='sync-dot saving'; this.mobileText.textContent = msg; }
	},
	setOk(msg='Synchronisiert') { 
		if (this.el) { this.el.className='sync-indicator ok'; this.dot.className='sync-dot ok'; this.text.textContent = msg; }
		if (this.mobileEl) { this.mobileEl.className='sync-indicator ok'; this.mobileDot.className='sync-dot ok'; this.mobileText.textContent = msg; }
	},
	setError(msg='Offline/Fehler') { 
		if (this.el) { this.el.className='sync-indicator err'; this.dot.className='sync-dot err'; this.text.textContent = msg; }
		if (this.mobileEl) { this.mobileEl.className='sync-indicator err'; this.mobileDot.className='sync-dot err'; this.mobileText.textContent = msg; }
	},
	setIdle(msg) { 
		if (this.el) this.text.textContent = msg; 
		if (this.mobileEl) this.mobileText.textContent = msg; 
	}
};

// Wrap Save/Load um UI-Status
const _loadSup = loadSup; loadSup = async function() {
	try {
		syncUI.setSaving('Lade...');
		await _loadSup();
		syncUI.setOk('Geladen');
		setTimeout(()=>syncUI.updateSourceLabel(), 1200);
	} catch { syncUI.setError('Laden fehlgeschlagen'); }
};

const _saveSup = saveSup; saveSup = async function() {
	syncUI.setSaving('Speichere...');
	try { await _saveSup(); syncUI.setOk('Synchronisiert'); } catch { syncUI.setError('Fehler beim Speichern'); }
	finally { setTimeout(()=>syncUI.updateSourceLabel(), 1200); }
};

// ===== Ende Persistenz ===== 

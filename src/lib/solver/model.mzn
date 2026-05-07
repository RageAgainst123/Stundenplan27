% MS SiG Stundenplan generator – MVP model.
%
% Variables: for each "lesson instance" (one period of one LessonSpec) we choose
% a slot 1..NSLOTS where slot index s ↔ (day, period) = ((s-1) div P + 1, (s-1) mod P + 1).
%
% Hard constraints implemented:
%   - Teacher uniqueness per slot (unless lessons share groupKey)
%   - Grade uniqueness per slot (unless lessons share groupKey)
%   - Teacher availability (unavailable slots forbidden)
%   - Pinned lessons fixed to their slot
%   - Even/odd week-pattern lessons may share a slot (but not with each other and not with 'every')
%
% Soft constraints (penalty objective): omitted in MVP. Solver runs `solve satisfy`.
% Once the SAT path is verified end-to-end we switch to a weighted minimize objective.

include "globals.mzn";

% ---- Sizes ----
int: D;                  % number of days
int: P;                  % periods per day
int: T;                  % number of teachers
int: G;                  % number of grades (=4 here)
int: L;                  % number of lesson instances (after expanding count)
int: NSLOTS = D * P;

set of int: SLOT  = 1..NSLOTS;
set of int: TEACHER = 1..T;
set of int: GRADE = 1..G;
set of int: LESSON = 1..L;

% ---- Lesson instance data ----
array[LESSON] of TEACHER: lesson_teacher;
array[LESSON] of set of GRADE: lesson_grades;
array[LESSON] of int: lesson_group;       % 0 = no group; >0 = shared coupling key
array[LESSON] of int: lesson_week;        % 0=every,1=even,2=odd
array[LESSON] of bool: lesson_pinned;     % if true, lesson_pin_slot must be respected
array[LESSON] of SLOT: lesson_pin_slot;   % only meaningful when lesson_pinned[l]

% Teacher unavailability: 1 if teacher t blocked at slot s
array[TEACHER, SLOT] of bool: teacher_blocked;

% ---- Decision variable ----
array[LESSON] of var SLOT: assign;

% ---- Hard constraints ----

% 1) Pinned lessons fixed
constraint forall (l in LESSON where lesson_pinned[l]) (
  assign[l] = lesson_pin_slot[l]
);

% 2) Teacher availability respected
constraint forall (l in LESSON, s in SLOT where teacher_blocked[lesson_teacher[l], s]) (
  assign[l] != s
);

% 3) Teacher conflict: two lessons in same slot must share group
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_teacher[l1] = lesson_teacher[l2]) (
  (assign[l1] = assign[l2]) -> (lesson_group[l1] != 0 /\ lesson_group[l1] = lesson_group[l2])
);

% 4) Grade conflict: two lessons covering the same grade in same slot must share group
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  card(lesson_grades[l1] intersect lesson_grades[l2]) > 0) (
  (assign[l1] = assign[l2]) -> (lesson_group[l1] != 0 /\ lesson_group[l1] = lesson_group[l2])
);

% 5) Week pattern: even+odd may not coexist; every+even or every+odd not allowed in same slot
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_week[l1] != lesson_week[l2]) (
  (assign[l1] = assign[l2]) -> false
);
% (Allowed: same week pattern OR explicit group sharing — but cross-pattern slot sharing is rejected.)

% ---- Solve ----
solve satisfy;

output [
  "{ \"assign\": [", join(",", [show(assign[l]) | l in LESSON]), "] }"
];

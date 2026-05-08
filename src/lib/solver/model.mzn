% MS SiG Stundenplan generator – MVP model.
%
% A "slot" indexes (day, period, grade) so multiple grades can have lessons at
% the same (day, period) without conflict.
%   slot index s ∈ 1..NSLOTS where NSLOTS = D * P * G
%   day(s) = ((s-1) div (P*G)) + 1
%   period(s) = (((s-1) div G) mod P) + 1
%   grade(s) = ((s-1) mod G) + 1
%
% Hard constraints:
%   - Pinned lessons fixed
%   - Teacher availability respected
%   - Teacher uniqueness per (day, period) — same teacher can't be in two
%     places at once (unless lessons share a group)
%   - Grade uniqueness per (day, period) — same grade can't have two lessons
%     at once (unless they share a group)
%   - Even/odd week pattern compatibility
%   - Distinct slots for multiple instances of the same spec

include "globals.mzn";

% ---- Sizes ----
int: D;                  % number of days
int: P;                  % periods per day
int: T;                  % number of teachers
int: G;                  % number of grades (=4)
int: L;                  % number of lesson instances (after expanding count)
int: NSLOTS = D * P * G;

set of int: SLOT  = 1..NSLOTS;
set of int: TEACHER = 1..T;
set of int: GRADE = 1..G;
set of int: LESSON = 1..L;

% ---- Helpers (work for both var and par int) ----
function var int: dayOf(var int: s)    = ((s - 1) div (P * G)) + 1;
function var int: periodOf(var int: s) = (((s - 1) div G) mod P) + 1;
function var int: gradeOf(var int: s)  = ((s - 1) mod G) + 1;

% ---- Lesson instance data ----
array[LESSON] of TEACHER: lesson_teacher;
array[LESSON] of set of GRADE: lesson_grades;
array[LESSON] of int: lesson_group;       % 0 = no group; >0 = shared coupling key
array[LESSON] of int: lesson_week;        % 0=every,1=even,2=odd
array[LESSON] of int: lesson_spec_id;     % spec-id index — instances of same spec share this
array[LESSON] of bool: lesson_pinned;     % if true, lesson_pin_slot must be respected
array[LESSON] of SLOT: lesson_pin_slot;   % only meaningful when lesson_pinned[l]

% Teacher unavailability: true if teacher t blocked at (day,period) — grade-independent
array[TEACHER, 1..D, 1..P] of bool: teacher_blocked;

% ---- Decision variable ----
% Each lesson is assigned to a slot, but the slot's grade must be in lesson_grades.
array[LESSON] of var SLOT: assign;

% ---- Hard constraints ----

% 0) Slot's grade must be one of the lesson's grades
constraint forall (l in LESSON) (
  gradeOf(assign[l]) in lesson_grades[l]
);

% 1) Pinned lessons fixed
constraint forall (l in LESSON where lesson_pinned[l]) (
  assign[l] = lesson_pin_slot[l]
);

% 2) Teacher availability respected (block whole (day,period) regardless of grade)
constraint forall (l in LESSON, s in SLOT where
                  teacher_blocked[lesson_teacher[l], dayOf(s), periodOf(s)]) (
  assign[l] != s
);

% 3) Teacher conflict: two lessons in same (day,period) by same teacher must share a group
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_teacher[l1] = lesson_teacher[l2]) (
  (dayOf(assign[l1]) = dayOf(assign[l2]) /\ periodOf(assign[l1]) = periodOf(assign[l2]))
    -> (lesson_group[l1] != 0 /\ lesson_group[l1] = lesson_group[l2])
);

% 4) Slot conflict: two lessons must not occupy the SAME (day,period,grade)
%    unless they share an explicit coupling group (parallel teaching).
constraint forall (l1, l2 in LESSON where l1 < l2) (
  (assign[l1] = assign[l2])
    -> (lesson_group[l1] != 0 /\ lesson_group[l1] = lesson_group[l2])
);

% 5) Week pattern: even+odd may not coexist in same (day,period,grade) slot
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_week[l1] != lesson_week[l2]) (
  assign[l1] != assign[l2]
);

% 6) Distinct (day, period) for two instances of the same spec from DIFFERENT
%    occurrences. (Two grade-instances of the SAME occurrence may share the
%    same day/period — they represent the same lesson taught to multiple grades.)
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_spec_id[l1] = lesson_spec_id[l2] /\
                  lesson_group[l1] != lesson_group[l2]) (
  not (dayOf(assign[l1]) = dayOf(assign[l2]) /\ periodOf(assign[l1]) = periodOf(assign[l2]))
);

% ---- Solve ----
solve satisfy;

output [
  "{ \"assign\": [", join(",", [show(assign[l]) | l in LESSON]), "] }"
];

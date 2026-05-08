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
%   - Slot uniqueness — two lessons must not share (day,period,grade) unless they
%     belong to the same coupling group (parallel teaching)
%   - Even/odd week pattern compatibility
%   - Distinct (day,period) for two instances of the same spec from different
%     occurrences (each lesson goes on its own day or period)
%   - Block-pattern: instances marked with the same block_id must be contiguous
%     within the same day, same grade
%   - Subject maxConsecutive: per (day, grade), no longer run of the same subject
%     than the subject's max_consec value (currently we only enforce the common
%     case max=2 — three of same subject in a row is forbidden)

include "globals.mzn";

% ---- Sizes ----
int: D;                  % number of days
int: P;                  % periods per day
int: T;                  % number of teachers
int: G;                  % number of grades (=4)
int: L;                  % number of lesson instances (after expanding count × blocks × grades)
int: S;                  % number of subjects
int: NSLOTS = D * P * G;

set of int: SLOT  = 1..NSLOTS;
set of int: TEACHER = 1..T;
set of int: GRADE = 1..G;
set of int: LESSON = 1..L;
set of int: SUBJECT = 1..S;

% ---- Helpers (work for both var and par int) ----
function var int: dayOf(var int: s)    = ((s - 1) div (P * G)) + 1;
function var int: periodOf(var int: s) = (((s - 1) div G) mod P) + 1;
function var int: gradeOf(var int: s)  = ((s - 1) mod G) + 1;

% ---- Lesson instance data ----
array[LESSON] of TEACHER: lesson_teacher;
array[LESSON] of SUBJECT: lesson_subject;
array[LESSON] of set of GRADE: lesson_grades;
array[LESSON] of int: lesson_group;       % 0 = no group; >0 = shared coupling key
array[LESSON] of int: lesson_week;        % 0=every,1=even,2=odd
array[LESSON] of int: lesson_spec_id;     % spec-id index — instances of same spec share this
array[LESSON] of int: lesson_block_id;    % -1 = standalone, ≥0 = part of a block
array[LESSON] of int: lesson_block_size;  % size of the block this instance belongs to (1=standalone)
array[LESSON] of bool: lesson_pinned;
array[LESSON] of SLOT: lesson_pin_slot;

% Subject-level maxConsecutive (e.g. Mathe = 2)
array[SUBJECT] of int: subject_max_consec;

% Teacher unavailability
array[TEACHER, 1..D, 1..P] of bool: teacher_blocked;

% ---- Decision variable ----
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

% 2) Teacher availability respected
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

% 4) Slot conflict: two lessons must not occupy the SAME (day,period,grade) unless
%    they share an explicit coupling group (parallel teaching).
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
%    occurrences (= different occurrence groupId).
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_spec_id[l1] = lesson_spec_id[l2] /\
                  lesson_group[l1] != lesson_group[l2]) (
  not (dayOf(assign[l1]) = dayOf(assign[l2]) /\ periodOf(assign[l1]) = periodOf(assign[l2]))
);

% 7) Block-pattern: instances with the same block_id (same spec, same block) must
%    sit on the same day, same grade, and be CONTIGUOUS in periods.
%    We enforce: same day, same grade, |period_a - period_b| <= block_size - 1
%    + the periods of one block must form a contiguous run.
%    Pairwise: same day, same grade, abs period diff exactly 1 between adjacent
%    instances of the block. We use weaker constraint:
%    same day, same grade, periods within [min..min+block_size-1].
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_block_id[l1] >= 0 /\
                  lesson_block_id[l1] = lesson_block_id[l2]) (
  dayOf(assign[l1]) = dayOf(assign[l2]) /\
  gradeOf(assign[l1]) = gradeOf(assign[l2]) /\
  abs(periodOf(assign[l1]) - periodOf(assign[l2])) <= lesson_block_size[l1] - 1
);

% 8) Subject maxConsecutive: forbid a 3-run of the same subject in same day & grade
%    when subject_max_consec[s] = 2.
constraint forall (l1, l2, l3 in LESSON where l1 < l2 /\ l2 < l3 /\
                  lesson_subject[l1] = lesson_subject[l2] /\
                  lesson_subject[l2] = lesson_subject[l3] /\
                  subject_max_consec[lesson_subject[l1]] = 2) (
  not (
    dayOf(assign[l1]) = dayOf(assign[l2]) /\ dayOf(assign[l2]) = dayOf(assign[l3]) /\
    gradeOf(assign[l1]) = gradeOf(assign[l2]) /\ gradeOf(assign[l2]) = gradeOf(assign[l3]) /\
    abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1 /\
    abs(periodOf(assign[l2]) - periodOf(assign[l3])) = 1 /\
    abs(periodOf(assign[l1]) - periodOf(assign[l3])) = 2
  )
);

% ---- Solve ----
solve satisfy;

output [
  "{ \"assign\": [", join(",", [show(assign[l]) | l in LESSON]), "] }"
];

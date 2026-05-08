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
%   - Group cohesion — two lessons in the SAME group_id (>0) MUST land on the
%     same (day,period). Covers explicit user couplings AND the synthetic
%     occurrence groups used to keep multi-grade siblings together.
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
array[LESSON] of int: lesson_occ_idx;     % occurrence index 0..count-1 within the spec
array[LESSON] of int: lesson_block_id;    % -1 = standalone, ≥0 = part of a block
array[LESSON] of int: lesson_block_size;  % size of the block this instance belongs to (1=standalone)
array[LESSON] of bool: lesson_auto;       % Phase 7B: true = auto-mode (solver decides if pair becomes a double)
array[LESSON] of bool: lesson_pinned;
array[LESSON] of SLOT: lesson_pin_slot;

% Subject-level maxConsecutive (e.g. Mathe = 2)
array[SUBJECT] of int: subject_max_consec;

% Phase 7B: Subject-level main-subject flag (for soft constraints)
array[SUBJECT] of bool: subject_is_main;

% Phase 7B: Soft-constraint weights (0 = disabled)
int: w_no_free;          % keine Freistunden für Klassen
int: w_main_aft;         % kein Hauptfach am Nachmittag
int: afternoon_start;    % erste Periode die als Nachmittag zählt (z.B. 7)
int: w_main_run;         % kein zu langer Hauptfach-Run
int: max_consec_main;    % erlaubte max-Länge eines Hauptfach-Runs (z.B. 2)
int: w_main_early;       % Hauptfach bevorzugt früh am Tag
int: w_compact;          % Lehrer-Tage kompakt (wenig Freistunden im Lehrertag)

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

% 4a) Slot conflict: two lessons must not occupy the SAME (day,period,grade) unless
%     they share an explicit coupling group (parallel teaching).
constraint forall (l1, l2 in LESSON where l1 < l2) (
  (assign[l1] = assign[l2])
    -> (lesson_group[l1] != 0 /\ lesson_group[l1] = lesson_group[l2])
);

% 4b) Group cohesion: two lessons in the SAME group_id (>0) MUST land on the
%     same (day, period). Used both for explicit couplings (parallel teaching
%     across teachers) AND for multi-grade siblings of a single pedagogical
%     lesson — e.g. BSP for grades 7+8 with count=1 expands to 2 lesson
%     instances (one per grade column) that share an occurrence group; they
%     have to be taught at the same time, not split across the week.
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_group[l1] != 0 /\
                  lesson_group[l1] = lesson_group[l2]) (
  dayOf(assign[l1]) = dayOf(assign[l2]) /\
  periodOf(assign[l1]) = periodOf(assign[l2])
);

% 5) Week pattern: even+odd may not coexist in same (day,period,grade) slot
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_week[l1] != lesson_week[l2]) (
  assign[l1] != assign[l2]
);

% 6) Distinct (day, period) for two instances of the same spec from DIFFERENT
%    occurrences. We use lesson_occ_idx (NOT lesson_group) because specs with an
%    explicit couplingId share the same group_id across all occurrences — using
%    group here would let multiple occurrences collapse onto the same slot.
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_spec_id[l1] = lesson_spec_id[l2] /\
                  lesson_occ_idx[l1] != lesson_occ_idx[l2]) (
  not (dayOf(assign[l1]) = dayOf(assign[l2]) /\ periodOf(assign[l1]) = periodOf(assign[l2]))
);

% 7) Block-pattern: instances with the same block_id (same spec, same block)
%    must sit on the same day and within the block's period range.
%
%    Note: For multi-grade specs, the encoder produces ONE instance per
%    (block-position × grade). All those instances share the same block_id
%    but have DIFFERENT grades. So we must NOT require gradeOf to be equal —
%    that would make multi-grade blocks UNSAT (Phase 7A bug #1).
%
%    For block-siblings of the SAME grade-column (= same spec, same grade),
%    their periods must form a contiguous run of length blockSize. We enforce
%    pairwise: same day + |Δperiod| ≤ blockSize-1.
%    For block-siblings on DIFFERENT grade columns (multi-grade parallel),
%    they share day & period (enforced via groupId in constraint 4).
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_block_id[l1] >= 0 /\
                  lesson_block_id[l1] = lesson_block_id[l2]) (
  dayOf(assign[l1]) = dayOf(assign[l2]) /\
  abs(periodOf(assign[l1]) - periodOf(assign[l2])) <= lesson_block_size[l1] - 1
);

% 8) Subject maxConsecutive: forbid a 3-run of the same subject in same day & grade
%    when subject_max_consec[s] = 2.
%    Phase 7A fix: ignore multi-grade siblings — two instances of the same
%    occurrence (same spec, same group_id) represent ONE lesson taught to
%    multiple grades, not two separate runs of the subject. Without this,
%    a count=4 multi-grade Mathe spec would self-trigger the constraint.
constraint forall (l1, l2, l3 in LESSON where l1 < l2 /\ l2 < l3 /\
                  lesson_subject[l1] = lesson_subject[l2] /\
                  lesson_subject[l2] = lesson_subject[l3] /\
                  subject_max_consec[lesson_subject[l1]] = 2 /\
                  not (lesson_spec_id[l1] = lesson_spec_id[l2] /\ lesson_occ_idx[l1] = lesson_occ_idx[l2]) /\
                  not (lesson_spec_id[l2] = lesson_spec_id[l3] /\ lesson_occ_idx[l2] = lesson_occ_idx[l3]) /\
                  not (lesson_spec_id[l1] = lesson_spec_id[l3] /\ lesson_occ_idx[l1] = lesson_occ_idx[l3])) (
  not (
    dayOf(assign[l1]) = dayOf(assign[l2]) /\ dayOf(assign[l2]) = dayOf(assign[l3]) /\
    gradeOf(assign[l1]) = gradeOf(assign[l2]) /\ gradeOf(assign[l2]) = gradeOf(assign[l3]) /\
    abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1 /\
    abs(periodOf(assign[l2]) - periodOf(assign[l3])) = 1 /\
    abs(periodOf(assign[l1]) - periodOf(assign[l3])) = 2
  )
);

% 9) Auto-Mode (Phase 7B): for specs where the user has NOT chosen an explicit
%    block pattern, the solver may form AT MOST ONE double-period pair per spec
%    (same day, same grade, |Δperiod|=1) and MUST NOT form 3-period runs.
%
%    Rationale: schools rarely teach the same subject for ≥3 consecutive
%    periods. Strict patterns (like blocks=[1,1,1] or [2,1]) override this and
%    skip the auto-mode logic — those instances have lesson_auto[l]=false.

% 9a) No 3-period run within an auto-mode spec on the same day & grade.
constraint forall (l1, l2, l3 in LESSON where l1 < l2 /\ l2 < l3 /\
                  lesson_auto[l1] /\ lesson_auto[l2] /\ lesson_auto[l3] /\
                  lesson_spec_id[l1] = lesson_spec_id[l2] /\
                  lesson_spec_id[l2] = lesson_spec_id[l3] /\
                  lesson_occ_idx[l1] != lesson_occ_idx[l2] /\
                  lesson_occ_idx[l2] != lesson_occ_idx[l3] /\
                  lesson_occ_idx[l1] != lesson_occ_idx[l3]) (
  not (
    dayOf(assign[l1]) = dayOf(assign[l2]) /\ dayOf(assign[l2]) = dayOf(assign[l3]) /\
    gradeOf(assign[l1]) = gradeOf(assign[l2]) /\ gradeOf(assign[l2]) = gradeOf(assign[l3]) /\
    abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1 /\
    abs(periodOf(assign[l2]) - periodOf(assign[l3])) = 1 /\
    abs(periodOf(assign[l1]) - periodOf(assign[l3])) = 2
  )
);

% 9b) At most ONE double-pair per spec in auto-mode.
%     A "double pair" is two auto-mode instances of the same spec that share
%     day & grade and sit on adjacent periods. We count those over each pair
%     of distinct occurrences (l1<l2) and require sum ≤ 1 per spec.
%
%     For multi-grade specs, the SAME occurrence is duplicated across grade
%     columns (different lessons sharing spec_id+occ_idx). Those grade-columns
%     are bound to the same (day, period) via the groupId, so a pair on one
%     grade implies the same pair on every grade — which would inflate the
%     count to (#grades) and falsely fail. To count each pedagogical "double"
%     exactly once, we restrict to instances in the SMALLEST grade column of
%     the spec (gradeOf(assign[l]) = min(lesson_grades[l])).
%
%     Note: lesson_grades[l] is a singleton in the encoder, so min() = the
%     grade. We additionally require both partners to be in the same grade —
%     thanks to the singleton, this holds automatically when their grades
%     are equal. We pick the lowest grade across each pair as a canonical
%     witness.
constraint forall (sp in 1..max(lesson_spec_id)) (
  sum(l1, l2 in LESSON where l1 < l2 /\
      lesson_spec_id[l1] = sp /\ lesson_spec_id[l2] = sp /\
      lesson_auto[l1] /\ lesson_auto[l2] /\
      lesson_occ_idx[l1] != lesson_occ_idx[l2] /\
      min(lesson_grades[l1]) = min(lesson_grades[l2]) /\
      min(lesson_grades[l1]) = min([min(lesson_grades[ll]) | ll in LESSON where lesson_spec_id[ll] = sp])) (
    bool2int(
      dayOf(assign[l1]) = dayOf(assign[l2]) /\
      gradeOf(assign[l1]) = gradeOf(assign[l2]) /\
      abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1
    )
  ) <= 1
);

% ---- Soft Constraints (Phase 7B) ------------------------------------
%
% Each penalty term is a sum of integer indicators times its weight.
% A weight of 0 zeroes the term out (the toggle is off in the UI).
%
% Penalties are computed as par/var ints over the assign[] decision array.

% Note: each penalty is wrapped in an `if weight > 0 then ... else 0 endif`
% guard. When the user has the toggle off (weight=0), the var int reduces to a
% literal 0 at compile time, which dramatically cuts solver work.

% P1) "Hauptfach nicht am Nachmittag":
%     count instances l where subject is_main AND periodOf(assign[l]) >= afternoon_start.
var int: pen_main_aft =
  if w_main_aft > 0 then
    sum(l in LESSON where subject_is_main[lesson_subject[l]]) (
      bool2int(periodOf(assign[l]) >= afternoon_start)
    )
  else 0 endif;

% P2) "Hauptfach früh am Tag":
%     for every main-subject lesson, add (period - 1). Earlier = lower penalty.
var int: pen_main_early =
  if w_main_early > 0 then
    sum(l in LESSON where subject_is_main[lesson_subject[l]]) (
      periodOf(assign[l]) - 1
    )
  else 0 endif;

% P3) "Max N Hauptfächer in Folge" (approximation):
%     pairwise count: for every pair of main-subject instances (l1<l2) that
%     end up on the same (day, grade) on adjacent periods, add 1. This
%     overcounts true 3+ runs but is the cheapest faithful approximation —
%     the more clustered the main subjects, the higher the penalty.
var int: pen_main_run =
  if w_main_run > 0 then
    sum(l1, l2 in LESSON where l1 < l2 /\
        subject_is_main[lesson_subject[l1]] /\
        subject_is_main[lesson_subject[l2]]) (
      bool2int(
        dayOf(assign[l1]) = dayOf(assign[l2]) /\
        gradeOf(assign[l1]) = gradeOf(assign[l2]) /\
        abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1
      )
    )
  else 0 endif;

% P4) "Keine Freistunden für Klassen":
%     A "free period" for a grade is a period p such that there exists at
%     least one lesson on that day & grade in a period > p AND no lesson on
%     that day & grade at period p.
var int: pen_no_free =
  if w_no_free > 0 then
    sum(d in 1..D, g in 1..G, p in 1..P) (
      bool2int(
        not exists(l in LESSON) (
          dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g /\ periodOf(assign[l]) = p
        ) /\
        exists(l in LESSON) (
          dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g /\ periodOf(assign[l]) < p
        ) /\
        exists(l in LESSON) (
          dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g /\ periodOf(assign[l]) > p
        )
      )
    )
  else 0 endif;

% P5) "Lehrer-Tage kompakt":
%     same idea as P4 but per teacher: free periods sandwiched between
%     occupied periods on the same day.
var int: pen_compact =
  if w_compact > 0 then
    sum(t in 1..T, d in 1..D, p in 1..P) (
      bool2int(
        not exists(l in LESSON where lesson_teacher[l] = t) (
          dayOf(assign[l]) = d /\ periodOf(assign[l]) = p
        ) /\
        exists(l in LESSON where lesson_teacher[l] = t) (
          dayOf(assign[l]) = d /\ periodOf(assign[l]) < p
        ) /\
        exists(l in LESSON where lesson_teacher[l] = t) (
          dayOf(assign[l]) = d /\ periodOf(assign[l]) > p
        )
      )
    )
  else 0 endif;

% Total weighted penalty
var int: total_penalty =
  w_main_aft * pen_main_aft +
  w_main_early * pen_main_early +
  w_main_run * pen_main_run +
  w_no_free * pen_no_free +
  w_compact * pen_compact;

% ---- Solve ----
solve :: int_search([assign[l] | l in LESSON], first_fail, indomain_min, complete)
  minimize total_penalty;

output [
  "{ \"assign\": [", join(",", [show(assign[l]) | l in LESSON]),
  "], \"penalties\": { ",
  "\"main_aft\": ", show(pen_main_aft), ", ",
  "\"main_early\": ", show(pen_main_early), ", ",
  "\"main_run\": ", show(pen_main_run), ", ",
  "\"no_free\": ", show(pen_no_free), ", ",
  "\"compact\": ", show(pen_compact), ", ",
  "\"total\": ", show(total_penalty),
  " } }"
];

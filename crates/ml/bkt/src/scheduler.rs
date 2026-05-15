use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::bkt::KnowledgeState;

/// Scheduled review for a concept, combining SM-2 with BKT modulation.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReviewSchedule {
    pub concept_id: String,
    pub next_review_at: DateTime<Utc>,
    pub interval_days: f32,
    pub ease_factor: f32,
}

/// Compute the next review schedule using SM-2 modulated by BKT mastery.
///
/// - Base ease factor starts at 2.5.
/// - Mastery modulation: ease *= 0.8 + 0.4 * p_mastery.
/// - Slow response (>30s) penalizes ease by 0.1.
/// - Incorrect answers reset interval to 1 day and reduce ease.
/// - Correct answers follow SM-2 progression: 1 -> 6 -> prev * ease.
pub fn schedule_review(
    state: &KnowledgeState,
    last_review: DateTime<Utc>,
    is_correct: bool,
    response_time_ms: u32,
) -> ReviewSchedule {
    let mut ease_factor: f32 = 2.5;

    // Modulate by mastery: lower mastery = smaller multiplier = shorter intervals.
    ease_factor *= 0.8 + 0.4 * state.p_mastery;

    // Slow response penalty.
    if response_time_ms > 30_000 {
        ease_factor -= 0.1;
    }

    let interval_days: f32;

    if !is_correct {
        interval_days = 1.0;
        ease_factor -= 0.2;
        ease_factor = ease_factor.max(1.3);
    } else {
        // SM-2 progression based on total_interactions (before this interaction).
        match state.total_interactions {
            0 => interval_days = 1.0,
            1 => interval_days = 6.0,
            _ => {
                // Estimate previous interval from the interaction count.
                // For the third correct review and beyond, use ease_factor scaling.
                // We approximate the previous interval as 6 * ease^(n-2).
                let n = state.total_interactions;
                let mut prev = 6.0_f32;
                for _ in 2..n {
                    prev *= ease_factor;
                }
                interval_days = prev * ease_factor;
            }
        }
    }

    // Clamp ease_factor.
    let ease_factor = ease_factor.clamp(1.3, 3.0);

    let interval_duration = Duration::seconds((interval_days * 86400.0) as i64);
    let next_review_at = last_review + interval_duration;

    ReviewSchedule {
        concept_id: String::new(),
        next_review_at,
        interval_days,
        ease_factor,
    }
}

/// Return all schedules that are due for review (next_review_at <= now),
/// sorted by next_review_at ascending (most overdue first).
pub fn get_due_reviews<'a>(
    schedules: &'a [ReviewSchedule],
    now: DateTime<Utc>,
) -> Vec<&'a ReviewSchedule> {
    let mut due: Vec<&ReviewSchedule> = schedules
        .iter()
        .filter(|s| s.next_review_at <= now)
        .collect();
    due.sort_by(|a, b| a.next_review_at.cmp(&b.next_review_at));
    due
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bkt::KnowledgeState;

    #[test]
    fn correct_answer_reasonable_interval() {
        let state = KnowledgeState::default();
        let now = Utc::now();
        let schedule = schedule_review(&state, now, true, 5000);
        assert!(
            schedule.interval_days >= 1.0,
            "first correct interval should be >= 1 day: {}",
            schedule.interval_days,
        );
        assert!(schedule.next_review_at > now);
        assert!(schedule.ease_factor >= 1.3 && schedule.ease_factor <= 3.0);
    }

    #[test]
    fn incorrect_answer_resets_to_one_day() {
        let state = KnowledgeState {
            p_mastery: 0.5,
            total_interactions: 5,
            correct_interactions: 4,
            ..KnowledgeState::default()
        };
        let now = Utc::now();
        let schedule = schedule_review(&state, now, false, 5000);
        assert!(
            (schedule.interval_days - 1.0).abs() < f32::EPSILON,
            "incorrect should reset to 1 day: {}",
            schedule.interval_days,
        );
    }

    #[test]
    fn low_mastery_reduces_ease_factor() {
        let low = KnowledgeState {
            p_mastery: 0.1,
            ..KnowledgeState::default()
        };
        let high = KnowledgeState {
            p_mastery: 0.9,
            ..KnowledgeState::default()
        };
        let now = Utc::now();

        let schedule_low = schedule_review(&low, now, true, 5000);
        let schedule_high = schedule_review(&high, now, true, 5000);

        assert!(
            schedule_low.ease_factor < schedule_high.ease_factor,
            "low mastery ease {} should be less than high mastery ease {}",
            schedule_low.ease_factor,
            schedule_high.ease_factor,
        );
    }

    #[test]
    fn slow_response_reduces_ease() {
        let state = KnowledgeState {
            p_mastery: 0.5,
            ..KnowledgeState::default()
        };
        let now = Utc::now();

        let fast = schedule_review(&state, now, true, 5000);
        let slow = schedule_review(&state, now, true, 35_000);

        assert!(
            slow.ease_factor < fast.ease_factor,
            "slow response ease {} should be less than fast ease {}",
            slow.ease_factor,
            fast.ease_factor,
        );
    }

    #[test]
    fn get_due_reviews_filters_correctly() {
        let now = Utc::now();
        let past = now - Duration::hours(1);
        let future = now + Duration::hours(1);

        let schedules = vec![
            ReviewSchedule {
                concept_id: "a".into(),
                next_review_at: past,
                interval_days: 1.0,
                ease_factor: 2.5,
            },
            ReviewSchedule {
                concept_id: "b".into(),
                next_review_at: future,
                interval_days: 6.0,
                ease_factor: 2.5,
            },
            ReviewSchedule {
                concept_id: "c".into(),
                next_review_at: past - Duration::hours(2),
                interval_days: 1.0,
                ease_factor: 2.0,
            },
        ];

        let due = get_due_reviews(&schedules, now);
        assert_eq!(due.len(), 2, "should have 2 due reviews");
        // Should be sorted ascending: c (oldest) then a.
        assert_eq!(due[0].concept_id, "c");
        assert_eq!(due[1].concept_id, "a");
    }

    #[test]
    fn get_due_reviews_empty_when_none_due() {
        let now = Utc::now();
        let future = now + Duration::hours(1);

        let schedules = vec![ReviewSchedule {
            concept_id: "x".into(),
            next_review_at: future,
            interval_days: 1.0,
            ease_factor: 2.5,
        }];

        let due = get_due_reviews(&schedules, now);
        assert!(due.is_empty());
    }

    #[test]
    fn ease_factor_clamped() {
        // Very high mastery should not push ease above 3.0.
        let state = KnowledgeState {
            p_mastery: 0.999,
            ..KnowledgeState::default()
        };
        let now = Utc::now();
        let schedule = schedule_review(&state, now, true, 5000);
        assert!(schedule.ease_factor <= 3.0);

        // Very low mastery + incorrect + slow should not drop ease below 1.3.
        let low = KnowledgeState {
            p_mastery: 0.01,
            ..KnowledgeState::default()
        };
        let schedule2 = schedule_review(&low, now, false, 60_000);
        assert!(schedule2.ease_factor >= 1.3);
    }
}

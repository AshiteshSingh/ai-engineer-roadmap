use serde::{Deserialize, Serialize};

/// Per-concept Bayesian Knowledge Tracing state.
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct KnowledgeState {
    /// Probability the learner has mastered the concept.
    pub p_mastery: f32,
    /// Probability of transitioning from unlearned to learned on each opportunity.
    pub p_transit: f32,
    /// Probability the learner slips (knows but answers wrong).
    pub p_slip: f32,
    /// Probability the learner guesses correctly without knowing.
    pub p_guess: f32,
    /// Total number of interactions.
    pub total_interactions: u32,
    /// Number of correct interactions.
    pub correct_interactions: u32,
}

impl Default for KnowledgeState {
    fn default() -> Self {
        Self {
            p_mastery: 0.1,
            p_transit: 0.1,
            p_slip: 0.1,
            p_guess: 0.2,
            total_interactions: 0,
            correct_interactions: 0,
        }
    }
}

/// Discrete mastery level derived from p_mastery.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MasteryLevel {
    Novice,
    Beginner,
    Intermediate,
    Proficient,
    Expert,
}

/// Standard BKT posterior update.
///
/// Given the current knowledge state and whether the learner answered correctly,
/// compute the posterior probability of mastery and return an updated state.
pub fn update(state: &KnowledgeState, is_correct: bool) -> KnowledgeState {
    let p_correct =
        state.p_mastery * (1.0 - state.p_slip) + (1.0 - state.p_mastery) * state.p_guess;
    let p_incorrect = 1.0 - p_correct;

    let p_learned_given_obs = if is_correct {
        state.p_mastery * (1.0 - state.p_slip) / p_correct
    } else {
        state.p_mastery * state.p_slip / p_incorrect
    };

    // Apply learning transition.
    let new_p_mastery = p_learned_given_obs + (1.0 - p_learned_given_obs) * state.p_transit;
    let new_p_mastery = new_p_mastery.clamp(0.001, 0.999);

    KnowledgeState {
        p_mastery: new_p_mastery,
        p_transit: state.p_transit,
        p_slip: state.p_slip,
        p_guess: state.p_guess,
        total_interactions: state.total_interactions + 1,
        correct_interactions: if is_correct {
            state.correct_interactions + 1
        } else {
            state.correct_interactions
        },
    }
}

/// Map a mastery probability to a discrete level.
pub fn mastery_level(p: f32) -> MasteryLevel {
    if p < 0.2 {
        MasteryLevel::Novice
    } else if p < 0.4 {
        MasteryLevel::Beginner
    } else if p < 0.6 {
        MasteryLevel::Intermediate
    } else if p < 0.8 {
        MasteryLevel::Proficient
    } else {
        MasteryLevel::Expert
    }
}

/// Predict the probability of a correct response.
///
/// P(correct) = P(L) * (1 - P(S)) + (1 - P(L)) * P(G)
pub fn predict_correct(state: &KnowledgeState) -> f32 {
    state.p_mastery * (1.0 - state.p_slip) + (1.0 - state.p_mastery) * state.p_guess
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_values() {
        let s = KnowledgeState::default();
        assert!((s.p_mastery - 0.1).abs() < f32::EPSILON);
        assert!((s.p_transit - 0.1).abs() < f32::EPSILON);
        assert!((s.p_slip - 0.1).abs() < f32::EPSILON);
        assert!((s.p_guess - 0.2).abs() < f32::EPSILON);
        assert_eq!(s.total_interactions, 0);
        assert_eq!(s.correct_interactions, 0);
    }

    #[test]
    fn correct_answer_increases_mastery() {
        let s = KnowledgeState::default();
        let updated = update(&s, true);
        assert!(
            updated.p_mastery > s.p_mastery,
            "correct answer should increase p_mastery: {} > {}",
            updated.p_mastery,
            s.p_mastery,
        );
        assert_eq!(updated.total_interactions, 1);
        assert_eq!(updated.correct_interactions, 1);
    }

    #[test]
    fn incorrect_answer_decreases_mastery() {
        // Start with moderate mastery so a wrong answer can lower it.
        let s = KnowledgeState {
            p_mastery: 0.5,
            ..KnowledgeState::default()
        };
        let updated = update(&s, false);
        assert!(
            updated.p_mastery < s.p_mastery,
            "incorrect answer should decrease p_mastery: {} < {}",
            updated.p_mastery,
            s.p_mastery,
        );
        assert_eq!(updated.total_interactions, 1);
        assert_eq!(updated.correct_interactions, 0);
    }

    #[test]
    fn mastery_level_thresholds() {
        assert_eq!(mastery_level(0.0), MasteryLevel::Novice);
        assert_eq!(mastery_level(0.1), MasteryLevel::Novice);
        assert_eq!(mastery_level(0.19), MasteryLevel::Novice);
        assert_eq!(mastery_level(0.2), MasteryLevel::Beginner);
        assert_eq!(mastery_level(0.39), MasteryLevel::Beginner);
        assert_eq!(mastery_level(0.4), MasteryLevel::Intermediate);
        assert_eq!(mastery_level(0.59), MasteryLevel::Intermediate);
        assert_eq!(mastery_level(0.6), MasteryLevel::Proficient);
        assert_eq!(mastery_level(0.79), MasteryLevel::Proficient);
        assert_eq!(mastery_level(0.8), MasteryLevel::Expert);
        assert_eq!(mastery_level(1.0), MasteryLevel::Expert);
    }

    #[test]
    fn predict_correct_range() {
        let s = KnowledgeState::default();
        let p = predict_correct(&s);
        assert!(p >= 0.0 && p <= 1.0, "p_correct should be in [0,1]: {p}");

        // With high mastery, prediction should be high.
        let expert = KnowledgeState {
            p_mastery: 0.95,
            ..KnowledgeState::default()
        };
        let p_expert = predict_correct(&expert);
        assert!(p_expert > 0.8, "expert should have high p_correct: {p_expert}");
    }

    #[test]
    fn multiple_correct_updates_converge_toward_mastery() {
        let mut s = KnowledgeState::default();
        for _ in 0..50 {
            s = update(&s, true);
        }
        assert!(
            s.p_mastery > 0.9,
            "50 correct answers should push mastery high: {}",
            s.p_mastery,
        );
        assert_eq!(s.total_interactions, 50);
        assert_eq!(s.correct_interactions, 50);
    }

    #[test]
    fn multiple_incorrect_updates_keep_mastery_low() {
        let mut s = KnowledgeState::default();
        for _ in 0..20 {
            s = update(&s, false);
        }
        assert!(
            s.p_mastery < 0.3,
            "20 incorrect answers should keep mastery low: {}",
            s.p_mastery,
        );
        assert_eq!(s.total_interactions, 20);
        assert_eq!(s.correct_interactions, 0);
    }

    #[test]
    fn edge_case_mastery_near_zero() {
        let s = KnowledgeState {
            p_mastery: 0.001,
            ..KnowledgeState::default()
        };
        let updated = update(&s, true);
        assert!(updated.p_mastery >= 0.001);
        assert!(updated.p_mastery <= 0.999);

        let updated2 = update(&s, false);
        assert!(updated2.p_mastery >= 0.001);
        assert!(updated2.p_mastery <= 0.999);
    }

    #[test]
    fn edge_case_mastery_near_one() {
        let s = KnowledgeState {
            p_mastery: 0.999,
            ..KnowledgeState::default()
        };
        let updated = update(&s, true);
        assert!(updated.p_mastery >= 0.001);
        assert!(updated.p_mastery <= 0.999);

        let updated2 = update(&s, false);
        assert!(updated2.p_mastery >= 0.001);
        assert!(updated2.p_mastery <= 0.999);
    }

    #[test]
    fn transit_slip_guess_unchanged_after_update() {
        let s = KnowledgeState::default();
        let updated = update(&s, true);
        assert!((updated.p_transit - s.p_transit).abs() < f32::EPSILON);
        assert!((updated.p_slip - s.p_slip).abs() < f32::EPSILON);
        assert!((updated.p_guess - s.p_guess).abs() < f32::EPSILON);
    }

    #[test]
    fn predict_correct_matches_formula() {
        let s = KnowledgeState {
            p_mastery: 0.5,
            p_slip: 0.15,
            p_guess: 0.25,
            ..KnowledgeState::default()
        };
        let expected = 0.5 * (1.0 - 0.15) + 0.5 * 0.25;
        let actual = predict_correct(&s);
        assert!(
            (actual - expected).abs() < 1e-6,
            "predict_correct mismatch: {actual} vs {expected}",
        );
    }
}

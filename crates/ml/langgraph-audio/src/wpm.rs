/// Average narration speed. 150 WPM is a common reference for audiobook /
/// podcast narration — slower than conversational speech (~180 WPM) to leave
/// breathing room for technical terms.
pub const NARRATION_WPM: u32 = 150;

/// Rough duration estimate from a raw word count. Rounds to the nearest
/// second; never returns 0 for non-empty input so the audio player always has
/// a positive chapter length.
pub fn estimate_secs(words: usize) -> u32 {
    if words == 0 {
        return 0;
    }
    let secs = (words as u32 * 60) / NARRATION_WPM;
    secs.max(1)
}

pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_words_is_zero_secs() {
        assert_eq!(estimate_secs(0), 0);
    }

    #[test]
    fn one_word_rounds_up_to_one_sec() {
        assert_eq!(estimate_secs(1), 1);
    }

    #[test]
    fn one_hundred_fifty_words_is_sixty_secs() {
        assert_eq!(estimate_secs(NARRATION_WPM as usize), 60);
    }

    #[test]
    fn word_count_ignores_whitespace_runs() {
        assert_eq!(count_words("  hello   world\n\nfoo "), 3);
    }
}

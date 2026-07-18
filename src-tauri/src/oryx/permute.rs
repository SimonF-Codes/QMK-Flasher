//! The Oryx→LAYOUT_moonlander key-order permutation.
//!
//! Oryx orders keys left half 0–35 then right half 36–71; `LAYOUT_moonlander`
//! interleaves the halves per row, with one anomaly in right row 4 (Oryx
//! 63–68 land in args 60–65 as `[68, 63, 64, 65, 66, 67]`). Verified against
//! the TD/QK_LOCK/combo positions of the real keymap (see the unit test in
//! `seed.rs` that re-derives this table from the fixture pair).

/// `ORYX_TO_LAYOUT[layout_arg] == oryx_index`.
pub const ORYX_TO_LAYOUT: [usize; 72] = [
    0, 1, 2, 3, 4, 5, 6, // args 0–6 ← oryx 0–6 (left row 1)
    36, 37, 38, 39, 40, 41, 42, // args 7–13 ← oryx 36–42 (right row 1)
    7, 8, 9, 10, 11, 12, 13, // args 14–20 ← oryx 7–13 (left row 2)
    43, 44, 45, 46, 47, 48, 49, // args 21–27 ← oryx 43–49 (right row 2)
    14, 15, 16, 17, 18, 19, 20, // args 28–34 ← oryx 14–20 (left row 3)
    50, 51, 52, 53, 54, 55, 56, // args 35–41 ← oryx 50–56 (right row 3)
    21, 22, 23, 24, 25, 26, // args 42–47 ← oryx 21–26 (left row 4)
    57, 58, 59, 60, 61, 62, // args 48–53 ← oryx 57–62 (right row 4)
    27, 28, 29, 30, 31, 32, // args 54–59 ← oryx 27–32 (left row 5)
    68, 63, 64, 65, 66, 67, // args 60–65 ← the right-row-5 anomaly
    33, 34, 35, // args 66–68 ← oryx 33–35 (left thumbs)
    69, 70, 71, // args 69–71 ← oryx 69–71 (right thumbs)
];

/// Inverse lookup: the LAYOUT arg position a given Oryx index lands in.
/// Used to translate combo key indices at seed time.
pub fn layout_index_for_oryx(oryx_index: usize) -> Option<usize> {
    ORYX_TO_LAYOUT.iter().position(|&o| o == oryx_index)
}

/// Reorder a 72-entry Oryx-order slice into LAYOUT-arg order.
pub fn permute<T: Clone>(oryx_order: &[T]) -> Vec<T> {
    debug_assert_eq!(oryx_order.len(), ORYX_TO_LAYOUT.len());
    ORYX_TO_LAYOUT
        .iter()
        .map(|&o| oryx_order[o].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permutation_is_a_bijection() {
        let mut seen = [false; 72];
        for &o in &ORYX_TO_LAYOUT {
            assert!(!seen[o], "oryx index {o} appears twice");
            seen[o] = true;
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn inverse_round_trips() {
        for arg in 0..72 {
            let oryx = ORYX_TO_LAYOUT[arg];
            assert_eq!(layout_index_for_oryx(oryx), Some(arg));
        }
        assert_eq!(layout_index_for_oryx(72), None);
    }

    #[test]
    fn permute_reorders() {
        let oryx: Vec<usize> = (0..72).collect();
        let layout = permute(&oryx);
        assert_eq!(layout[0], 0);
        assert_eq!(layout[7], 36);
        assert_eq!(layout[60], 68); // the anomaly
        assert_eq!(layout[61], 63);
        assert_eq!(layout[71], 71);
    }
}

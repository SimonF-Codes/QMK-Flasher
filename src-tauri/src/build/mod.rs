//! MSYS firmware build — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! `build_firmware` builds the **saved** layout: it loads it from the store,
//! writes generated sources into `keymaps/<keymapName>/` (never
//! `arrows_together`), then runs the MSYS make (msys.rs), streaming every
//! output line through `on_log` (forwarded to the webview as `build-log`
//! events). Returns the path of the .bin copy under
//! `%APPDATA%\qmk-flasher\builds\`.

pub mod msys;

use crate::error::AppError;
use crate::{appcfg, codegen, layout};

pub fn build_firmware<F: FnMut(String)>(mut on_log: F) -> Result<String, AppError> {
    let layout = layout::store::load()?;
    let cfg = appcfg::get();
    let dir = codegen::write_sources(&layout, &cfg)?;
    on_log(format!("Sources written to {}", dir.display()));
    msys::build(&cfg, &mut on_log)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A3 acceptance: the real MSYS build. Ignored by default — run manually
    /// once with `cargo test real_msys_build -- --ignored --nocapture`.
    /// Produces a .bin whose size is within ~1% of the known-good
    /// arrows_together image (golden source parity ⇒ near-identical binary).
    #[test]
    #[ignore = "invokes the real MSYS toolchain (minutes); run manually for A3"]
    fn real_msys_build_produces_reference_sized_bin() {
        let mut lines = Vec::new();
        let path = build_firmware(|l| {
            println!("{l}");
            lines.push(l);
        })
        .expect("real build must succeed");
        assert!(path.ends_with(".bin"));
        let built = std::fs::metadata(&path).expect("built bin exists").len() as f64;
        let reference = std::fs::metadata(
            r"C:\Users\fridl\qmk_firmware\zsa_moonlander_reva_arrows_together.bin",
        )
        .expect("reference arrows_together bin exists")
        .len() as f64;
        let deviation = (built - reference).abs() / reference;
        assert!(
            deviation < 0.01,
            "built {built} bytes vs reference {reference} bytes ({:.2}% off)",
            deviation * 100.0
        );
    }
}

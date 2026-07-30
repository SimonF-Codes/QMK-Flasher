//! Dry-run codegen: render keymap.c / rules.mk / config.h from a layout JSON
//! file and print a summary, without launching the app or writing anything.
//! Useful for checking a hand-edited or newly-seeded layout still generates.
//!
//! ```text
//! cargo run --example gen_sources -- %APPDATA%\qmk-flasher\layouts\arrows-together.json
//! ```
//!
//! Optionally pass a second argument to grep the emitted keymap.c for a token:
//!
//! ```text
//! cargo run --example gen_sources -- <layout.json> CG_TOGG
//! ```

use qmk_flasher_lib::codegen;
use qmk_flasher_lib::layout::LayoutFile;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().unwrap_or_else(|| {
        eprintln!("usage: gen_sources <layout.json> [token-to-find]");
        std::process::exit(2);
    });
    let needle = args.next();

    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("cannot read {path}: {e}");
        std::process::exit(1);
    });
    let layout: LayoutFile = serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!("cannot parse {path}: {e}");
        std::process::exit(1);
    });

    let out = match codegen::generate(&layout) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("codegen failed: {e:?}");
            std::process::exit(1);
        }
    };

    println!(
        "ok: {} layers, keymap.c {} bytes, rules.mk {} bytes, config.h {} bytes",
        layout.layers.len(),
        out.keymap_c.len(),
        out.rules_mk.len(),
        out.config_h.len()
    );

    if let Some(n) = needle {
        let hits: Vec<_> = out
            .keymap_c
            .lines()
            .enumerate()
            .filter(|(_, l)| l.contains(&n))
            .collect();
        if hits.is_empty() {
            eprintln!("token {n:?} NOT found in keymap.c");
            std::process::exit(1);
        }
        println!("token {:?} found on {} line(s):", n, hits.len());
        for (i, l) in hits {
            println!("  {}: {}", i + 1, l.trim());
        }
    }

    println!("\n--- rules.mk ---\n{}", out.rules_mk);
}

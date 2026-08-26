//! The QMK MSYS build: exactly
//! `MSYSTEM=MINGW64 <msys>\usr\bin\bash.exe -lc "cd <qmk> && make
//! SKIP_VERSION=yes zsa/moonlander/revb:<keymap>"`, streaming stdout+stderr lines through the
//! caller's `FnMut` (the command layer forwards them as `build-log` events).
//! Never `qmk compile`. On success the .bin is copied to
//! `%APPDATA%\qmk-flasher\builds\<timestamp>.bin`.
//!
//! Deliberately `std::process`, not tokio: Tauri runs `(async)` command
//! handlers inside its own tokio runtime, and a nested `Runtime::block_on`
//! there panics ("Cannot start a runtime from within a runtime") — the
//! original `start_flash_pipeline` hang. Two pump threads feed an mpsc
//! channel; `on_log` runs on the caller's thread.

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;

use crate::appcfg::AppConfig;
use crate::error::AppError;
use crate::keyboards::KeyboardInfo;
use crate::layout::store;

/// `C:\Users\me\qmk_firmware` → `/c/Users/me/qmk_firmware`.
fn to_msys_path(win: &str) -> String {
    let s = win.replace('\\', "/");
    match s.split_once(":/") {
        Some((drive, rest)) if drive.len() == 1 => {
            format!("/{}/{rest}", drive.to_ascii_lowercase())
        }
        _ => s,
    }
}

/// The make target QMK derives the output name from.
fn make_target(kb: &KeyboardInfo, keymap: &str) -> String {
    format!("{}:{keymap}", kb.qmk_keyboard)
}

/// Where QMK drops the final image:
/// `<qmk>\<qmkKeyboard with / → _>_<keymap>.bin`.
fn built_bin_path(cfg: &AppConfig, kb: &KeyboardInfo) -> PathBuf {
    Path::new(&cfg.qmk_firmware_path).join(format!(
        "{}_{}.bin",
        kb.qmk_keyboard.replace('/', "_"),
        cfg.keymap_name
    ))
}

/// Run the build for `kb`, streaming every output line. Returns the path of
/// the copy under `%APPDATA%\qmk-flasher\builds\`.
pub fn build(
    cfg: &AppConfig,
    kb: &KeyboardInfo,
    on_log: &mut dyn FnMut(String),
) -> Result<String, AppError> {
    let bash = Path::new(&cfg.msys_path).join("usr").join("bin").join("bash.exe");
    if !bash.exists() {
        return Err(AppError::BuildFailed(format!(
            "QMK MSYS bash not found at {} — check the MSYS path in settings",
            bash.display()
        )));
    }
    // SKIP_VERSION=yes drops QMK's git-derived version.h step, which costs
    // ~50s of git invocations per build on Windows and only changes the
    // version string the firmware reports (bin size unaffected: 69416 both
    // ways). Measured: 239s -> 187s full rebuild, 83s -> 33s no-op. `-j` is
    // deliberately absent — QMK's recursive submake ignores it (238s at -j16
    // vs 239s serial, and MAKEFLAGS=-j16 makes no difference either).
    let script = format!(
        "cd {} && make SKIP_VERSION=yes {}",
        to_msys_path(&cfg.qmk_firmware_path),
        make_target(kb, &cfg.keymap_name)
    );
    on_log(format!("$ bash -lc \"{script}\""));

    let mut command = std::process::Command::new(&bash);
    command
        .arg("-lc")
        .arg(&script)
        .env("MSYSTEM", "MINGW64")
        .env("CHERE_INVOKING", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW — no console flash from the GUI app.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AppError::BuildFailed(format!("spawning bash: {e}")))?;

    let (tx, rx) = mpsc::channel::<String>();
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let tx2 = tx.clone();
    let pumps = [
        std::thread::spawn(move || pump(stdout, tx)),
        std::thread::spawn(move || pump(stderr, tx2)),
    ];
    // The channel closes when both pump threads drop their senders.
    for line in rx {
        if !is_known_noise(&line) {
            on_log(line);
        }
    }
    for p in pumps {
        let _ = p.join();
    }
    let status = child
        .wait()
        .map_err(|e| AppError::BuildFailed(format!("waiting for make: {e}")))?;

    if !status.success() {
        return Err(AppError::BuildFailed(format!(
            "make exited with {} — see the build log",
            status.code().map_or("signal".into(), |c| c.to_string())
        )));
    }

    let bin = built_bin_path(cfg, kb);
    if !bin.exists() {
        return Err(AppError::BuildFailed(format!(
            "build succeeded but {} was not produced",
            bin.display()
        )));
    }
    let builds_dir = store::data_dir()?.join("builds");
    let io = |e: std::io::Error| AppError::BuildFailed(format!("copying firmware: {e}"));
    std::fs::create_dir_all(&builds_dir).map_err(io)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = builds_dir.join(format!("{stamp}.bin"));
    std::fs::copy(&bin, &dest).map_err(io)?;
    on_log(format!("Firmware ready: {}", dest.display()));
    Ok(dest.to_string_lossy().into_owned())
}

/// Known-harmless noise in QMK's Makefile parse phase: `qmk list-layouts
/// --keyboard zsa/moonlander/revb` (community-layout discovery) trips over
/// the parent folder `zsa/moonlander` not being a keyboard itself and prints
/// a one-line `ValueError` to stderr while make proceeds normally. A real
/// bad target still fails `make` itself (exit code + its own error lines),
/// which this filter never touches.
fn is_known_noise(line: &str) -> bool {
    line.trim_start_matches(['☒', ' '])
        .starts_with("ValueError: Invalid keyboard: ")
}

fn pump(reader: impl std::io::Read, tx: mpsc::Sender<String>) {
    let lines = std::io::BufReader::new(reader).lines();
    for line in lines {
        let Ok(line) = line else { break };
        if tx.send(line).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn msys_path_conversion() {
        assert_eq!(
            to_msys_path(r"C:\Users\me\qmk_firmware"),
            "/c/Users/me/qmk_firmware"
        );
        assert_eq!(to_msys_path("D:/already/forward"), "/d/already/forward");
        assert_eq!(to_msys_path("relative/path"), "relative/path");
    }

    fn moonlander() -> &'static KeyboardInfo {
        crate::keyboards::get("moonlander").unwrap()
    }

    #[test]
    fn make_target_and_bin_name_derive_from_the_registry() {
        assert_eq!(
            make_target(moonlander(), "qmk_flasher"),
            "zsa/moonlander/revb:qmk_flasher"
        );
        let cfg = crate::appcfg::get();
        assert!(built_bin_path(&cfg, moonlander())
            .ends_with("zsa_moonlander_revb_qmk_flasher.bin"));
    }

    #[test]
    fn known_noise_filter_is_narrow() {
        // The exact line (milc prints a ☒ glyph prefix) and a bare variant.
        assert!(is_known_noise("☒ ValueError: Invalid keyboard: zsa/moonlander"));
        assert!(is_known_noise("ValueError: Invalid keyboard: zsa/moonlander"));
        // Real build output must never be filtered.
        assert!(!is_known_noise("Compiling: keyboards/zsa/moonlander/matrix.c"));
        assert!(!is_known_noise("make: *** No rule to make target 'zsa/moonlander:x'. Stop."));
        assert!(!is_known_noise("error: 'ValueError: Invalid keyboard: ' in a C string"));
    }

    /// Regression test for the `start_flash_pipeline` panic: Tauri runs the
    /// `(async)` command handler inside its multi-thread tokio runtime, so
    /// `build` executes on a tokio worker driving async tasks. It must
    /// stream + return a normal error there — never panic ("Cannot start a
    /// runtime from within a runtime", the old tokio-based implementation).
    #[test]
    fn build_streams_and_errors_inside_a_tokio_runtime_context() {
        let cfg = crate::appcfg::get();
        if !Path::new(&cfg.msys_path).join("usr/bin/bash.exe").exists() {
            eprintln!("QMK MSYS not installed; skipping runtime-context test");
            return;
        }
        // A dir that exists but is no qmk_firmware checkout: bash+make run
        // for real and fail fast with "No rule to make target".
        let tmp = std::env::temp_dir().join("qmk-flasher-msys-ctx-test");
        std::fs::create_dir_all(&tmp).unwrap();
        let cfg = AppConfig {
            qmk_firmware_path: tmp.to_string_lossy().into_owned(),
            ..cfg
        };
        // Multi-thread flavor: what Tauri actually runs commands on. The
        // handler body executes inside an async task (NOT spawn_blocking),
        // which is where a nested `Runtime::block_on` panics.
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let (err, lines) = rt.block_on(async move {
            tokio::spawn(async move {
                let mut lines = Vec::new();
                let err = build(&cfg, moonlander(), &mut |l| lines.push(l)).unwrap_err();
                (err, lines)
            })
            .await
            .expect("build must not panic inside a runtime context")
        });
        assert_eq!(err.code(), "BuildFailed");
        assert!(!lines.is_empty(), "make output must be streamed");
    }

    #[test]
    fn missing_bash_is_a_build_error() {
        let cfg = AppConfig {
            msys_path: r"C:\definitely\not\msys".into(),
            ..crate::appcfg::get()
        };
        let err = build(&cfg, moonlander(), &mut |_| {}).unwrap_err();
        assert_eq!(err.code(), "BuildFailed");
        assert!(err.to_string().contains("bash not found"));
    }
}

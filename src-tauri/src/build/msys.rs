//! The QMK MSYS build: exactly
//! `MSYSTEM=MINGW64 <msys>\usr\bin\bash.exe -lc "cd <qmk> && make
//! zsa/moonlander/reva:<keymap>"` via tokio::process, streaming stdout+stderr
//! lines through the caller's `FnMut` (the command layer forwards them as
//! `build-log` events). Never `qmk compile`. On success the .bin is copied to
//! `%APPDATA%\qmk-flasher\builds\<timestamp>.bin`.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::appcfg::AppConfig;
use crate::error::AppError;
use crate::layout::store;

/// `C:\Users\fridl\qmk_firmware` → `/c/Users/fridl/qmk_firmware`.
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
fn make_target(keymap: &str) -> String {
    format!("zsa/moonlander/reva:{keymap}")
}

/// Where QMK drops the final image: `<qmk>\zsa_moonlander_reva_<keymap>.bin`.
fn built_bin_path(cfg: &AppConfig) -> PathBuf {
    Path::new(&cfg.qmk_firmware_path)
        .join(format!("zsa_moonlander_reva_{}.bin", cfg.keymap_name))
}

/// Run the build, streaming every output line. Returns the path of the copy
/// under `%APPDATA%\qmk-flasher\builds\`.
pub fn build(cfg: &AppConfig, on_log: &mut dyn FnMut(String)) -> Result<String, AppError> {
    let bash = Path::new(&cfg.msys_path).join("usr").join("bin").join("bash.exe");
    if !bash.exists() {
        return Err(AppError::BuildFailed(format!(
            "QMK MSYS bash not found at {} — check the MSYS path in settings",
            bash.display()
        )));
    }
    let script = format!(
        "cd {} && make {}",
        to_msys_path(&cfg.qmk_firmware_path),
        make_target(&cfg.keymap_name)
    );
    on_log(format!("$ bash -lc \"{script}\""));

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| AppError::BuildFailed(format!("tokio runtime: {e}")))?;

    let status = rt.block_on(async {
        let mut child = Command::new(&bash)
            .arg("-lc")
            .arg(&script)
            .env("MSYSTEM", "MINGW64")
            .env("CHERE_INVOKING", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::BuildFailed(format!("spawning bash: {e}")))?;

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");
        for reader in [
            tokio::task::spawn(pump(BufReader::new(stdout), tx.clone())),
            tokio::task::spawn(pump(BufReader::new(stderr), tx)),
        ] {
            drop(reader); // detached: they finish when the pipes close
        }
        while let Some(line) = rx.recv().await {
            on_log(line);
        }
        child
            .wait()
            .await
            .map_err(|e| AppError::BuildFailed(format!("waiting for make: {e}")))
    })?;

    if !status.success() {
        return Err(AppError::BuildFailed(format!(
            "make exited with {} — see the build log",
            status.code().map_or("signal".into(), |c| c.to_string())
        )));
    }

    let bin = built_bin_path(cfg);
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

async fn pump<R: tokio::io::AsyncRead + Unpin>(
    reader: BufReader<R>,
    tx: mpsc::UnboundedSender<String>,
) {
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
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
            to_msys_path(r"C:\Users\fridl\qmk_firmware"),
            "/c/Users/fridl/qmk_firmware"
        );
        assert_eq!(to_msys_path("D:/already/forward"), "/d/already/forward");
        assert_eq!(to_msys_path("relative/path"), "relative/path");
    }

    #[test]
    fn make_target_never_uses_qmk_compile() {
        assert_eq!(make_target("qmk_flasher"), "zsa/moonlander/reva:qmk_flasher");
    }

    #[test]
    fn missing_bash_is_a_build_error() {
        let cfg = AppConfig {
            msys_path: r"C:\definitely\not\msys".into(),
            ..crate::appcfg::get()
        };
        let err = build(&cfg, &mut |_| {}).unwrap_err();
        assert_eq!(err.code(), "BuildFailed");
        assert!(err.to_string().contains("bash not found"));
    }
}

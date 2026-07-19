//! Hardware test harness: flash a pre-built .bin through the real pipeline
//! (wait-for-bootloader → erase → download → leave), then verify the board
//! re-enumerates as the ZSA Moonlander. Usage:
//!
//! ```text
//! cargo run --example flash_bin -- C:\path\to\firmware.bin
//! ```
//!
//! Diagnostic-hardened after the first hardware attempt hung: the harness
//! does its own verbose watch (full bus scan printed at startup, arrivals/
//! removals per tick, open+claim probe on DFU arrival, 3-min timeout)
//! BEFORE handing off to the real pipeline, and installs a logger so the
//! library's swallowed `log::warn!`s (e.g. enumeration failures) reach
//! stderr.

use std::collections::BTreeSet;
use std::io::Write;
use std::time::{Duration, Instant};

use nusb::MaybeFuture;
use qmk_flasher_lib::events::PipelinePhase;
use qmk_flasher_lib::flash;

const DFU_VID: u16 = 0x0483;
const DFU_PID: u16 = 0xdf11;
const MOONLANDER_VID: u16 = 0x3297;
const MOONLANDER_PID: u16 = 0x1969;
const WAIT_TIMEOUT: Duration = Duration::from_secs(28_800);

/// Forward every library log record to stderr, timestamped.
struct StderrLogger;

impl log::Log for StderrLogger {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        eprintln!("[{}] [lib {}] {}", ts(), record.level(), record.args());
    }

    fn flush(&self) {
        let _ = std::io::stderr().flush();
    }
}

fn ts() -> String {
    chrono::Local::now().format("%H:%M:%S%.3f").to_string()
}

/// One bus scan: every (vid, pid, product-ish label). Err = enumeration
/// itself failed, which the stock watcher would have silently swallowed.
fn scan() -> Result<Vec<(u16, u16, String)>, String> {
    let devices = nusb::list_devices().wait().map_err(|e| format!("{e:?}"))?;
    Ok(devices
        .map(|d| {
            let label = d
                .product_string()
                .map(str::to_owned)
                .or_else(|| d.serial_number().map(|s| format!("serial {s}")))
                .unwrap_or_default();
            (d.vendor_id(), d.product_id(), label)
        })
        .collect())
}

fn key(v: u16, p: u16, label: &str) -> String {
    format!("{v:04x}:{p:04x} {label}")
}

/// Probe: can we actually open the DFU device and claim interface 0 the way
/// the flasher will? Prints the exact failure if not.
fn probe_dfu_open() -> bool {
    let info = match nusb::list_devices().wait() {
        Ok(mut d) => d.find(|d| d.vendor_id() == DFU_VID && d.product_id() == DFU_PID),
        Err(e) => {
            println!("[{}] probe: enumeration failed: {e:?}", ts());
            return false;
        }
    };
    let Some(info) = info else {
        println!("[{}] probe: DFU device vanished before open", ts());
        return false;
    };
    let device = match info.open().wait() {
        Ok(d) => d,
        Err(e) => {
            println!("[{}] probe: OPEN FAILED: {e:?} — driver/permissions finding", ts());
            return false;
        }
    };
    match device.claim_interface(0).wait() {
        Ok(_iface) => {
            println!("[{}] probe: open + claim_interface(0) OK — device is flashable", ts());
            true // device/interface dropped here, released before the real flash
        }
        Err(e) => {
            println!("[{}] probe: CLAIM FAILED: {e:?} — driver/permissions finding", ts());
            false
        }
    }
}

/// Verbose wait: prints the full bus at startup, arrivals/removals per tick,
/// handles already-in-DFU-at-start, times out instead of hanging.
fn wait_for_dfu_verbose() -> Result<(), i32> {
    let mut known: BTreeSet<String> = BTreeSet::new();
    let mut last_err: Option<String> = None;

    match scan() {
        Ok(devices) => {
            println!("[{}] startup bus scan — {} devices:", ts(), devices.len());
            for (v, p, label) in &devices {
                println!("    {v:04x}:{p:04x}  {label}");
                known.insert(key(*v, *p, label));
            }
        }
        Err(e) => {
            println!("[{}] startup bus scan FAILED: {e}", ts());
            last_err = Some(e);
        }
    }

    let dfu_at_start = known.iter().any(|k| k.starts_with("0483:df11"));
    if dfu_at_start {
        println!("[{}] DFU device ALREADY PRESENT at startup — no reset press needed", ts());
    } else {
        println!();
        println!("==============================================================");
        println!("  READY — press reset now");
        println!("  Paperclip into the small hole, TOP-LEFT of the LEFT half.");
        println!("  Watching for 0483:df11 (timeout: 3 minutes)...");
        println!("==============================================================");
        println!();
    }

    let deadline = Instant::now() + WAIT_TIMEOUT;
    loop {
        match scan() {
            Ok(devices) => {
                let current: BTreeSet<String> = devices
                    .iter()
                    .map(|(v, p, label)| key(*v, *p, label))
                    .collect();
                for gone in known.difference(&current) {
                    println!("[{}] − removed: {gone}", ts());
                }
                for new in current.difference(&known) {
                    println!("[{}] + arrived: {new}", ts());
                }
                known = current;

                if devices.iter().any(|(v, p, _)| *v == DFU_VID && *p == DFU_PID) {
                    println!("[{}] DFU DEVICE DETECTED (0483:df11)", ts());
                    probe_dfu_open();
                    // Hand off to the real pipeline either way — if the probe
                    // failed we still want the pipeline's own error surfaced.
                    return Ok(());
                }
            }
            Err(e) => {
                if last_err.as_ref() != Some(&e) {
                    println!("[{}] enumeration FAILED this tick: {e}", ts());
                    last_err = Some(e);
                }
            }
        }

        if Instant::now() >= deadline {
            eprintln!(
                "[{}] TIMEOUT: no 0483:df11 within {} s. Last enumeration error: {}",
                ts(),
                WAIT_TIMEOUT.as_secs(),
                last_err.as_deref().unwrap_or("none — enumeration worked, device never appeared")
            );
            return Err(3);
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn moonlander_present() -> bool {
    matches!(
        scan(),
        Ok(devices) if devices
            .iter()
            .any(|(v, p, _)| *v == MOONLANDER_VID && *p == MOONLANDER_PID)
    )
}

fn main() {
    static LOGGER: StderrLogger = StderrLogger;
    let _ = log::set_logger(&LOGGER).map(|()| log::set_max_level(log::LevelFilter::Debug));

    let bin_path = std::env::args().nth(1).expect("usage: flash_bin <firmware.bin>");

    // nusb's futures need a tokio reactor (Handle::current panics otherwise —
    // observed on hardware 2026-07-19). Run the whole flash on a blocking
    // thread inside a real multi-thread runtime, which is exactly the context
    // Tauri gives command handlers in the production app.
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async move {
        tokio::task::spawn_blocking(move || run(bin_path))
            .await
            .expect("flash task panicked");
    });
}

fn run(bin_path: String) {
    println!("[{}] firmware: {bin_path}", ts());

    if let Err(code) = wait_for_dfu_verbose() {
        std::process::exit(code);
    }

    // Device confirmed present (and probed). The pipeline re-runs its own
    // debounced wait — with the device already attached that adds ~500 ms.
    let mut last_percent: Option<u8> = None;
    let result = flash::flash_firmware(&bin_path, |state| match state.phase {
        PipelinePhase::WaitingForBootloader => {
            println!("[{}] [pipeline] waitingForBootloader (device already present — debouncing)", ts())
        }
        PipelinePhase::Erasing => {
            println!("[{}] [erasing] flash erase started (dfu-core reports no erase progress)", ts())
        }
        PipelinePhase::Flashing => {
            if state.progress != last_percent {
                last_percent = state.progress;
                if let Some(p) = state.progress {
                    println!("[{}] [flashing] {p}%", ts());
                }
            }
        }
        PipelinePhase::Leaving => {
            println!("[{}] [leaving] manifest sent — device rebooting into firmware", ts())
        }
        PipelinePhase::Done => println!("[{}] [done] flash completed", ts()),
        other => println!("[{}] [{other:?}] {:?}", ts(), state.detail),
    });

    match result {
        Ok(()) => println!("[{}] Flash pipeline finished OK.", ts()),
        Err(e) => {
            eprintln!("[{}] FLASH FAILED ({}): {e}", ts(), e.code());
            std::process::exit(1);
        }
    }

    println!("[{}] Waiting for the Moonlander (3297:1969) to re-enumerate...", ts());
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if moonlander_present() {
            println!("[{}] Moonlander re-enumerated as a keyboard. SUCCESS.", ts());
            return;
        }
        if Instant::now() >= deadline {
            eprintln!("[{}] Moonlander did NOT re-enumerate within 15 s — check the device.", ts());
            std::process::exit(2);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

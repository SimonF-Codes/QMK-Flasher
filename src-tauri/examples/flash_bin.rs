//! Hardware test harness: flash a pre-built .bin through the real pipeline
//! (wait-for-bootloader → erase → download → leave), then verify the board
//! re-enumerates as the ZSA Moonlander. Usage:
//!
//! ```text
//! cargo run --example flash_bin -- C:\path\to\firmware.bin
//! cargo run --example flash_bin            # probe only, writes nothing
//! ```
//!
//! With no argument it stops after the open/claim probe and descriptor dump
//! — enough to establish whether `nusb` can drive a given bootloader id
//! without risking a write.
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
use qmk_flasher_lib::flash::watcher::{is_known_bootloader, KNOWN_BOOTLOADERS};

/// ZSA's vendor id. The keyboard's product id is deliberately not pinned:
/// this board enumerates as 0x1972, older firmware as 0x1969. "Back in
/// normal firmware" means ZSA vid + not a bootloader pid.
const ZSA_VID: u16 = 0x3297;
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

/// Probe: can we actually open the bootloader and claim interface 0 the way
/// the flasher will? Prints the exact failure if not, plus the descriptors
/// that decide whether the DfuSe path applies — this is what tells us a
/// newly-seen bootloader id is really flashable and not just present.
fn probe_dfu_open() -> bool {
    let info = match nusb::list_devices().wait() {
        Ok(mut d) => d.find(|d| is_known_bootloader(d.vendor_id(), d.product_id())),
        Err(e) => {
            println!("[{}] probe: enumeration failed: {e:?}", ts());
            return false;
        }
    };
    let Some(info) = info else {
        println!("[{}] probe: DFU device vanished before open", ts());
        return false;
    };
    println!(
        "[{}] probe: target {:04x}:{:04x} {:?}",
        ts(),
        info.vendor_id(),
        info.product_id(),
        info.product_string().unwrap_or("<no product string>")
    );
    let device = match info.open().wait() {
        Ok(d) => d,
        Err(e) => {
            println!("[{}] probe: OPEN FAILED: {e:?} — driver/permissions finding", ts());
            return false;
        }
    };
    println!("[{}] probe: open OK", ts());
    describe_interfaces(&device);
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

/// Dump each interface's class/subclass/protocol, its DFU functional
/// descriptor (type 0x21) and its interface string. A DfuSe target reads
/// `class 0xfe subclass 0x01` with a string like
/// `@Internal Flash /0x08000000/...`; anything else means this bootloader
/// does not speak the protocol the flasher assumes.
fn describe_interfaces(device: &nusb::Device) {
    for config in device.configurations() {
        for alt in config.interface_alt_settings() {
            let name = alt
                .string_index()
                .and_then(|idx| {
                    device
                        // Short timeout on purpose: the whole probe has to
                        // fit inside the bootloader's ~7 s window.
                        .get_string_descriptor(idx, 0x0409, Duration::from_millis(250))
                        .wait()
                        .ok()
                })
                .unwrap_or_else(|| "<no string>".into());
            println!(
                "    iface {} alt {}: class {:02x} subclass {:02x} protocol {:02x}  {name:?}",
                alt.interface_number(),
                alt.alternate_setting(),
                alt.class(),
                alt.subclass(),
                alt.protocol()
            );
            for desc in alt.descriptors() {
                // 0x21 in a DFU interface is the DFU functional descriptor:
                // bmAttributes, wDetachTimeout, wTransferSize, bcdDFUVersion.
                if desc.descriptor_type() == 0x21 {
                    // Descriptor derefs to the whole trailing buffer; trim
                    // to this descriptor's own bLength.
                    let bytes = &desc[..desc.descriptor_len()];
                    println!("      DFU functional descriptor: {bytes:02x?}");
                }
            }
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

    let watching = watched_ids();
    let dfu_at_start = matches!(scan(), Ok(d) if d
        .iter()
        .any(|(v, p, _)| is_known_bootloader(*v, *p)));
    if dfu_at_start {
        println!("[{}] DFU device ALREADY PRESENT at startup — no reset press needed", ts());
    } else {
        println!();
        println!("==============================================================");
        println!("  READY — put the board in bootloader mode now");
        println!("  Either press QK_BOOT, or paperclip the small hole at the");
        println!("  TOP-LEFT of the LEFT half.");
        println!("  Watching for {watching}.");
        println!("  ZSA's bootloader self-terminates after ~7 s; this harness");
        println!("  polls every 100 ms and probes the instant it appears.");
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

                if let Some((v, p, _)) =
                    devices.iter().find(|(v, p, _)| is_known_bootloader(*v, *p))
                {
                    println!("[{}] DFU DEVICE DETECTED ({v:04x}:{p:04x})", ts());
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
                "[{}] TIMEOUT: none of {} within {} s. Last enumeration error: {}",
                ts(),
                watching,
                WAIT_TIMEOUT.as_secs(),
                last_err.as_deref().unwrap_or("none — enumeration worked, device never appeared")
            );
            return Err(3);
        }
        // ZSA's bootloader is only up for ~7 s per press, so poll fast
        // enough to catch it and still leave time to open it.
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn watched_ids() -> String {
    KNOWN_BOOTLOADERS
        .iter()
        .map(|b| format!("{:04x}:{:04x} ({})", b.vid, b.pid, b.revision))
        .collect::<Vec<_>>()
        .join(" or ")
}

/// Back in normal keyboard firmware: ZSA vid, and not a bootloader id.
fn moonlander_present() -> bool {
    matches!(
        scan(),
        Ok(devices) if devices
            .iter()
            .any(|(v, p, _)| *v == ZSA_VID && !is_known_bootloader(*v, *p))
    )
}

fn main() {
    static LOGGER: StderrLogger = StderrLogger;
    // Info, not Debug: nusb logs a line per device per enumeration, and the
    // watch polls 10x/s — Debug buries the arrival in thousands of lines.
    let _ = log::set_logger(&LOGGER).map(|()| log::set_max_level(log::LevelFilter::Info));

    let bin_path = std::env::args().nth(1);

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

fn run(bin_path: Option<String>) {
    match &bin_path {
        Some(p) => println!("[{}] firmware: {p}", ts()),
        None => println!("[{}] PROBE ONLY — no firmware argument, nothing will be written", ts()),
    }

    if let Err(code) = wait_for_dfu_verbose() {
        std::process::exit(code);
    }

    let Some(bin_path) = bin_path else {
        println!("[{}] probe finished — rerun with a .bin path to flash.", ts());
        return;
    };

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

    println!("[{}] Waiting for the Moonlander (3297:*) to re-enumerate...", ts());
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

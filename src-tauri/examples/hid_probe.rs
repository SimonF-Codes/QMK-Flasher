//! Hardware probe: read live key events straight off the board's raw-HID
//! channel. Read-only — nothing is flashed. Usage:
//!
//! ```text
//! cargo run --example hid_probe            # pair + listen 30s
//! cargo run --example hid_probe -- 60      # listen 60s
//! ```
//!
//! Why the HID API and not nusb (which the rest of the app uses): on Windows
//! every Moonlander interface is bound to HidUsb (hidclass.sys). nusb speaks
//! WinUSB, which can only claim interfaces bound to WinUSB, so it cannot open
//! these at all. Raw HID on Windows goes through the HID API instead.
//!
//! The protocol is ZSA's Oryx WebHID, already compiled into the firmware via
//! the `zsa/oryx` community module (`ORYX_ENABLE = yes`, which codegen already
//! emits) — see `modules/zsa/oryx/oryx.{c,h}` in qmk_firmware. Two facts make
//! this work without any firmware change:
//!
//!   * `pre_process_record_oryx` sends `{KEYDOWN|KEYUP, col, row}` for EVERY
//!     key while paired. Because it is a *pre*-process hook it fires before the
//!     keycode is consumed, so layer keys, QK_LOCK and RGB keys — the ones that
//!     never reach the OS — are all reported.
//!   * `layer_state_set_oryx` sends `{LAYER, n}` on every layer change, so the
//!     active layer is ground truth rather than inference.
//!
//! Pairing is a single command byte: `ORYX_CMD_PAIRING_INIT` falls straight
//! through to `pairing_success_event()`. The header's talk of a key-sequence
//! pairing code does not apply to this firmware revision.

use std::time::{Duration, Instant};

use hidapi::{HidApi, HidError};

/// ZSA. The PID is deliberately NOT pinned: this board enumerates as 0x1972
/// while `flash_bin.rs` hardcodes 0x1969, so PIDs vary by firmware variant.
const ZSA_VID: u16 = 0x3297;
/// QMK's raw-HID channel.
const RAW_USAGE_PAGE: u16 = 0xFF60;
const RAW_USAGE: u16 = 0x0061;
/// `RAW_EPSIZE` in oryx.h.
const RAW_EPSIZE: usize = 32;

// Oryx_Command_Code
const ORYX_CMD_PAIRING_INIT: u8 = 0x01;
// Oryx_Event_Code
const EVT_PAIRING_FAILED: u8 = 3;
const EVT_PAIRING_SUCCESS: u8 = 4;
const EVT_LAYER: u8 = 5;
const EVT_KEYDOWN: u8 = 6;
const EVT_KEYUP: u8 = 7;
const EVT_ERROR: u8 = 0xFF;

fn ts() -> String {
    chrono::Local::now().format("%H:%M:%S%.3f").to_string()
}

fn event_name(code: u8) -> &'static str {
    match code {
        0 => "GET_FW_VERSION",
        1 => "PAIRING_INPUT",
        2 => "PAIRING_KEY_INPUT",
        EVT_PAIRING_FAILED => "PAIRING_FAILED",
        EVT_PAIRING_SUCCESS => "PAIRING_SUCCESS",
        EVT_LAYER => "LAYER",
        EVT_KEYDOWN => "KEYDOWN",
        EVT_KEYUP => "KEYUP",
        8 => "RGB_CONTROL",
        9 => "TOGGLE_SMART_LAYER",
        10 => "TRIGGER_SMART_LAYER",
        11 => "STATUS_LED_CONTROL",
        0xFE => "GET_PROTOCOL_VERSION",
        EVT_ERROR => "ERROR",
        _ => "UNKNOWN",
    }
}

fn main() {
    let secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);

    let api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[{}] HID API unavailable: {e}", ts());
            std::process::exit(1);
        }
    };

    let target = api.device_list().find(|d| {
        d.vendor_id() == ZSA_VID
            && d.usage_page() == RAW_USAGE_PAGE
            && d.usage() == RAW_USAGE
    });
    let Some(info) = target else {
        eprintln!(
            "[{}] no ZSA raw-HID interface ({RAW_USAGE_PAGE:#06x}/{RAW_USAGE:#06x}) found.\n\
             Is the board plugged in, and was it built with ORYX_ENABLE?",
            ts()
        );
        std::process::exit(2);
    };
    println!(
        "[{}] found pid={:04x} iface={} usage_page={:#06x}",
        ts(),
        info.product_id(),
        info.interface_number(),
        info.usage_page()
    );

    let dev = match info.open_device(&api) {
        Ok(d) => d,
        Err(e) => {
            eprintln!(
                "[{}] cannot open: {}\nUsually another process holds it exclusively \
                 (ZSA Keymapp, or Oryx open in a browser tab).",
                ts(),
                describe(&e)
            );
            std::process::exit(3);
        }
    };

    // Windows HID writes are prefixed with a report ID; QMK raw HID uses none,
    // so byte 0 is 0x00 and the 32-byte payload follows.
    let mut cmd = [0u8; RAW_EPSIZE + 1];
    cmd[1] = ORYX_CMD_PAIRING_INIT;
    match dev.write(&cmd) {
        Ok(n) => println!("[{}] sent PAIRING_INIT ({n} bytes)", ts()),
        Err(e) => {
            eprintln!("[{}] pairing write failed: {}", ts(), describe(&e));
            std::process::exit(4);
        }
    }

    println!(
        "\n[{}] === listening {secs}s ===\n     \
         PRESS: a letter, then a layer key (MO), then QK_LOCK.\n",
        ts()
    );

    let mut buf = [0u8; RAW_EPSIZE];
    let deadline = Instant::now() + Duration::from_secs(secs);
    let (mut paired, mut keys, mut layers) = (false, 0usize, 0usize);

    while Instant::now() < deadline {
        match dev.read_timeout(&mut buf, 100) {
            Ok(0) => {}
            Ok(n) => {
                let code = buf[0];
                match code {
                    EVT_KEYDOWN | EVT_KEYUP => {
                        keys += 1;
                        // oryx.c packs col first, then row.
                        println!(
                            "[{}] {:<8} col={:<3} row={}",
                            ts(),
                            event_name(code),
                            buf[1],
                            buf[2]
                        );
                    }
                    EVT_LAYER => {
                        layers += 1;
                        println!("[{}] LAYER    -> {}", ts(), buf[1]);
                    }
                    EVT_PAIRING_SUCCESS => {
                        paired = true;
                        println!("[{}] PAIRING_SUCCESS", ts());
                    }
                    EVT_PAIRING_FAILED => println!("[{}] PAIRING_FAILED", ts()),
                    EVT_ERROR => println!("[{}] ERROR code={}", ts(), buf[1]),
                    _ => {
                        let hex: Vec<String> =
                            buf[..n.min(8)].iter().map(|b| format!("{b:02x}")).collect();
                        println!(
                            "[{}] {} ({}) {}",
                            ts(),
                            event_name(code),
                            code,
                            hex.join(" ")
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!("[{}] read error: {}", ts(), describe(&e));
                break;
            }
        }
    }

    println!("\n[{}] === summary ===", ts());
    println!("  paired: {paired}   key events: {keys}   layer events: {layers}");
    if keys > 0 {
        println!(
            "  VERDICT: the stock firmware reports every key by matrix position.\n\
             No reflash needed — geometry's `matrix: [row, col]` maps these\n\
             straight onto board positions."
        );
    } else if paired {
        println!("  VERDICT: paired but no key events — press keys during the window.");
    } else {
        println!("  VERDICT: no pairing response. Check nothing else holds the channel.");
    }
}

/// hidapi errors are opaque on Windows; surface what little detail exists.
fn describe(e: &HidError) -> String {
    match e {
        HidError::HidApiError { message } => message.clone(),
        other => format!("{other:?}"),
    }
}

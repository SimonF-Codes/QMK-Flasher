//! Live key reporting straight from the board's firmware.
//!
//! The keyboard already reports every keypress by matrix position over QMK's
//! raw-HID channel (usage page 0xFF60 / usage 0x61). This is ZSA's Oryx WebHID
//! protocol, compiled in via the `zsa/oryx` community module — which codegen
//! already enables (`ORYX_ENABLE = yes` in rules_mk.rs). No firmware change and
//! no reflash are involved.
//!
//! Why this beats reading keyboard events in the webview: `pre_process_record_oryx`
//! fires *before* the keycode is consumed, so keys QMK handles internally and
//! never sends to the OS — layer switches, QK_LOCK, RGB keys — are reported
//! too. `layer_state_set_oryx` reports the active layer, so layer state is
//! ground truth instead of inference.
//!
//! Pairing is one command byte: `ORYX_CMD_PAIRING_INIT` falls through to
//! `pairing_success_event()` in oryx.c. (The protocol header describes a
//! key-sequence pairing code; that does not apply to this firmware revision.)
//!
//! Windows note: every Moonlander interface binds to HidUsb (hidclass.sys), so
//! `nusb` — which the flashing code uses, and which speaks WinUSB — cannot open
//! this channel at all. Raw HID here goes through the HID API.
//!
//! Following the module rule in docs/CONTRACT.md, this exposes a plain function
//! taking a callback and never touches `AppHandle`; the command layer forwards
//! reports to the webview as events. The decoder is pure and unit-tested; only
//! the thin poll loop touches USB.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hidapi::{HidApi, HidDevice};

/// ZSA vendor id. The product id is deliberately not pinned — this board
/// enumerates as 0x1972 while `flash_bin.rs` hardcodes 0x1969, so it varies by
/// firmware variant. The raw-HID usage page identifies the interface instead.
pub const ZSA_VID: u16 = 0x3297;
/// QMK's raw-HID usage page / usage.
pub const RAW_USAGE_PAGE: u16 = 0xFF60;
pub const RAW_USAGE: u16 = 0x0061;
/// `RAW_EPSIZE` in oryx.h.
pub const RAW_EPSIZE: usize = 32;

/// Oryx_Command_Code
const CMD_PAIRING_INIT: u8 = 0x01;
const CMD_DISCONNECT: u8 = 0x03;

/// Oryx_Event_Code — only the ones we act on.
const EVT_PAIRING_FAILED: u8 = 3;
const EVT_PAIRING_SUCCESS: u8 = 4;
const EVT_LAYER: u8 = 5;
const EVT_KEYDOWN: u8 = 6;
const EVT_KEYUP: u8 = 7;
const EVT_ERROR: u8 = 0xFF;

/// How long to wait before retrying when the board is absent or drops.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// Read timeout; also how often the stop flag is checked.
const READ_TIMEOUT_MS: i32 = 100;

/// The running listener, if any. `Mutex<Option<..>>` rather than Tauri managed
/// state, mirroring `flash::pipeline::ACTIVE`, so `stop` needs no `AppHandle`.
///
/// There is deliberately no app-lifetime listener: pairing sets the board's
/// `rawhid_state.paired` flag, the same one ZSA Keymapp and Oryx use, so
/// holding it while live view is off would contend with those tools.
static ACTIVE: Mutex<Option<Listener>> = Mutex::new(None);

/// One decoded message from the board.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Report {
    /// A physical key changed state, identified by matrix position.
    Key { row: u8, col: u8, pressed: bool },
    /// The highest active layer changed.
    Layer { layer: u8 },
    Paired,
    PairingFailed,
    /// `Oryx_Error_Code` from the board.
    Error(u8),
}

/// Decode one raw-HID frame. Pure — the interesting logic, unit-tested without
/// hardware. Returns None for frames we don't model (RGB control, fw version…).
pub fn decode(frame: &[u8]) -> Option<Report> {
    // oryx.c packs {event, col, row}: col first, then row.
    match *frame.first()? {
        EVT_KEYDOWN => Some(Report::Key {
            row: *frame.get(2)?,
            col: *frame.get(1)?,
            pressed: true,
        }),
        EVT_KEYUP => Some(Report::Key {
            row: *frame.get(2)?,
            col: *frame.get(1)?,
            pressed: false,
        }),
        EVT_LAYER => Some(Report::Layer { layer: *frame.get(1)? }),
        EVT_PAIRING_SUCCESS => Some(Report::Paired),
        EVT_PAIRING_FAILED => Some(Report::PairingFailed),
        EVT_ERROR => Some(Report::Error(*frame.get(1)?)),
        _ => None,
    }
}

/// A command frame for the board. Byte 0 is the HID report id (QMK raw HID uses
/// none, so it stays 0) and the 32-byte payload follows.
fn command(code: u8) -> [u8; RAW_EPSIZE + 1] {
    let mut buf = [0u8; RAW_EPSIZE + 1];
    buf[1] = code;
    buf
}

/// Handle for stopping a running listener.
#[derive(Debug, Clone)]
pub struct Listener {
    stop: Arc<AtomicBool>,
}

impl Listener {
    /// Ask the listener to stop; it unpairs and exits on the next read tick.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
}

/// Listen for key reports until the returned [`Listener`] is stopped.
///
/// Reconnects on its own: if the board is absent or goes away, it retries every
/// [`RECONNECT_DELAY`] rather than giving up, so unplugging and replugging just
/// works. `on_event` is invoked from the listener thread.
pub fn spawn(mut on_event: impl FnMut(Report) + Send + 'static) -> Listener {
    let stop = Arc::new(AtomicBool::new(false));
    let listener = Listener { stop: stop.clone() };

    std::thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match session(&stop, &mut on_event) {
                Ok(()) => {}
                Err(e) => log::warn!("key report session ended: {e}"),
            }
            if stop.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(RECONNECT_DELAY);
        }
    });

    listener
}

/// Start the one shared listener, replacing any already running.
///
/// The channel is opened once up front so "ZSA Keymapp has it" or "the board
/// isn't plugged in" comes back as an error the user can read, instead of a
/// feature that silently never reports anything. Once past that, [`spawn`]
/// owns reconnection, so unplugging mid-session recovers on its own.
pub fn start(on_event: impl FnMut(Report) + Send + 'static) -> Result<(), String> {
    // Probe before taking the lock's contents away: a failed start must leave
    // whatever was running alone.
    let probe = open_raw_hid()?;
    drop(probe);

    let mut active = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(previous) = active.take() {
        previous.stop();
    }
    *active = Some(spawn(on_event));
    Ok(())
}

/// Stop the shared listener, if one is running. Idempotent.
pub fn stop() {
    let taken = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(listener) = taken {
        listener.stop();
    }
}

/// Whether a listener is currently held.
pub fn is_running() -> bool {
    ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .is_some_and(|l| !l.stopped())
}

/// Find and open the board's raw-HID interface.
fn open_raw_hid() -> Result<HidDevice, String> {
    let api = HidApi::new().map_err(|e| format!("HID API unavailable: {e}"))?;
    let info = api
        .device_list()
        .find(|d| {
            d.vendor_id() == ZSA_VID
                && d.usage_page() == RAW_USAGE_PAGE
                && d.usage() == RAW_USAGE
        })
        .ok_or_else(|| "no ZSA raw-HID interface present".to_string())?;

    info.open_device(&api)
        // Usually means something else holds it exclusively — ZSA Keymapp, or
        // Oryx open in a browser tab.
        .map_err(|e| format!("cannot open raw-HID interface: {e}"))
}

/// One connect → pair → read loop. Returns when the board drops or we're
/// stopped; the caller retries.
fn session(
    stop: &AtomicBool,
    on_event: &mut impl FnMut(Report),
) -> Result<(), String> {
    let dev = open_raw_hid()?;

    dev.write(&command(CMD_PAIRING_INIT))
        .map_err(|e| format!("pairing write failed: {e}"))?;

    let mut buf = [0u8; RAW_EPSIZE];
    while !stop.load(Ordering::SeqCst) {
        match dev.read_timeout(&mut buf, READ_TIMEOUT_MS) {
            Ok(0) => {}
            Ok(n) => {
                if let Some(report) = decode(&buf[..n]) {
                    on_event(report);
                }
            }
            Err(e) => return Err(format!("read failed: {e}")),
        }
    }

    // Leave the board unpaired so it stops streaming to nobody, and so Keymapp
    // or Oryx can take over cleanly. Best-effort: we're shutting down anyway.
    let _ = dev.write(&command(CMD_DISCONNECT));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_key_events_with_col_and_row_in_oryx_order() {
        // oryx.c writes col into byte 1 and row into byte 2 — the easy thing to
        // get backwards, so pin it.
        assert_eq!(
            decode(&[EVT_KEYDOWN, 6, 1, 0xFE]),
            Some(Report::Key { row: 1, col: 6, pressed: true })
        );
        assert_eq!(
            decode(&[EVT_KEYUP, 0, 8, 0xFE]),
            Some(Report::Key { row: 8, col: 0, pressed: false })
        );
    }

    #[test]
    fn decodes_layer_and_pairing_events() {
        assert_eq!(decode(&[EVT_LAYER, 3, 0xFE]), Some(Report::Layer { layer: 3 }));
        assert_eq!(decode(&[EVT_PAIRING_SUCCESS, 0xFE]), Some(Report::Paired));
        assert_eq!(decode(&[EVT_PAIRING_FAILED, 0xFE]), Some(Report::PairingFailed));
        assert_eq!(decode(&[EVT_ERROR, 4]), Some(Report::Error(4)));
    }

    #[test]
    fn ignores_frames_we_do_not_model() {
        // RGB control, firmware version, smart-layer chatter: not errors.
        assert_eq!(decode(&[8, 1, 0xFE]), None);
        assert_eq!(decode(&[0, 1, 2, 3]), None);
    }

    #[test]
    fn tolerates_truncated_frames_without_panicking() {
        // A short read must never index past the end.
        assert_eq!(decode(&[]), None);
        assert_eq!(decode(&[EVT_KEYDOWN]), None);
        assert_eq!(decode(&[EVT_KEYDOWN, 6]), None);
        assert_eq!(decode(&[EVT_LAYER]), None);
        assert_eq!(decode(&[EVT_ERROR]), None);
    }

    #[test]
    fn command_frame_carries_leading_report_id() {
        let cmd = command(CMD_PAIRING_INIT);
        assert_eq!(cmd.len(), RAW_EPSIZE + 1);
        assert_eq!(cmd[0], 0, "byte 0 is the HID report id and must stay 0");
        assert_eq!(cmd[1], CMD_PAIRING_INIT);
        assert!(cmd[2..].iter().all(|&b| b == 0));
    }

    #[test]
    fn listener_reports_stop() {
        let l = Listener { stop: Arc::new(AtomicBool::new(false)) };
        assert!(!l.stopped());
        l.stop();
        assert!(l.stopped());
    }

    /// Manual hardware check: opens the real channel and dumps what the board
    /// reports for 20 seconds. Run with the board plugged in and Keymapp/Oryx
    /// closed, then press keys:
    /// `cargo test -p qmk-flasher --lib keyreport -- --ignored --nocapture`
    #[test]
    #[ignore = "needs the board plugged in and a human pressing keys"]
    fn dump_live_reports_from_the_board() {
        let (tx, rx) = std::sync::mpsc::channel();
        start(move |r| {
            let _ = tx.send(r);
        })
        .expect("raw-HID channel opens");
        let until = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < until {
            if let Ok(r) = rx.recv_timeout(Duration::from_millis(200)) {
                println!("{r:?}");
            }
        }
        stop();
    }

    /// `start` needs hardware, so only the half that doesn't is asserted here:
    /// stopping when nothing runs must be a no-op, not a panic or a stale flag.
    /// The real path is verified on the board — see the commit message.
    #[test]
    fn stop_without_a_running_listener_is_a_noop() {
        stop();
        stop();
        assert!(!is_running());
    }
}

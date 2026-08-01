//! DFU flashing behind the [`Flasher`] trait.
//!
//! Primary backend: `dfu-core` + `dfu-nusb` speaking DfuSe (ST DFU 1.1a) to
//! whichever bootloader the board presents (`watcher::KNOWN_BOOTLOADERS` —
//! the STM32F303 ROM at 0483:df11, or ZSA's own Moonlander Bootloader at
//! 3297:2003): page erase, set address pointer 0x08000000, chunked
//! download, then zero-length download + GetStatus (manifest, dfu-util's
//! `:leave`) and a USB reset — the board re-enumerates as the ZSA
//! Moonlander (3297:1969 or 3297:1972). Behavioral reference: ZSA's
//! `wally-cli`. Neither bootloader can be bricked by a failed app-region
//! flash, so every mid-flash error is safe to retry.
//!
//! Fallback backend (cargo feature `dfu-util-fallback`, selected at runtime
//! with `QMK_FLASHER_DFU_BACKEND=dfu-util`): shells out to a bundled
//! `dfu-util.exe -a 0 -d <known ids> -s 0x08000000:leave -D <bin>` and
//! parses its progress output. Same trait, drop-in.

use std::io::Read;

use nusb::MaybeFuture;

use crate::error::AppError;
use crate::flash::pipeline::CancelToken;
use crate::flash::watcher::{find_bootloader, is_known_bootloader};

/// Start of the STM32 application flash region on a **rev A** board, whose
/// ROM bootloader hands the app all of flash. Rev B's app starts at
/// `0x08002000` instead — always prefer the `flash_base` of the
/// [`Bootloader`] actually found rather than assuming this one.
pub const FLASH_BASE: u32 = 0x0800_0000;
/// STM32F303xC flash size — a .bin larger than this cannot be right.
pub const FLASH_CAPACITY: usize = 256 * 1024;

/// Progress/phase reports emitted during a flash.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FlashEvent {
    /// Page erase running. dfu-util reports erase progress; dfu-core does not.
    Erasing { progress: Option<f32> },
    /// Firmware download, `progress` in 0.0–1.0.
    Downloading { progress: f32 },
    /// Manifest/leave issued — the device is rebooting into the app.
    Leaving,
}

/// How a flash attempt ended (errors are `Err(AppError)` instead).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlashOutcome {
    Completed,
    Cancelled,
}

/// A DFU flashing backend. Implementations never touch `AppHandle`; the
/// caller forwards events to the webview.
pub trait Flasher {
    fn flash(
        &mut self,
        firmware: &[u8],
        on_event: &mut dyn FnMut(FlashEvent),
        cancel: &CancelToken,
    ) -> Result<FlashOutcome, AppError>;
}

/// Validate a firmware image before touching the device.
pub fn validate_firmware(firmware: &[u8]) -> Result<(), AppError> {
    if firmware.is_empty() {
        return Err(AppError::BuildFailed("firmware image is empty".into()));
    }
    if firmware.len() > FLASH_CAPACITY {
        return Err(AppError::BuildFailed(format!(
            "firmware image is {} bytes, larger than the {} byte flash",
            firmware.len(),
            FLASH_CAPACITY
        )));
    }
    Ok(())
}

/// The address a Cortex-M image is linked to run at, read from its vector
/// table: word 0 is the initial stack pointer (SRAM, `0x2000_0000` on an
/// STM32F3), word 1 the reset vector — an address inside the image's own
/// flash region. Returns `None` if this does not look like a vector table.
pub fn image_link_base(firmware: &[u8]) -> Option<u32> {
    if firmware.len() < 8 {
        return None;
    }
    let word = |i: usize| u32::from_le_bytes(firmware[i..i + 4].try_into().unwrap());
    let initial_sp = word(0);
    let reset_vector = word(4);
    // Sanity-check it really is a vector table before trusting the reset
    // vector: SP in SRAM, reset vector in flash with the Thumb bit set.
    if initial_sp & 0xFFF0_0000 != 0x2000_0000 || reset_vector & 0xFF00_0000 != 0x0800_0000 {
        return None;
    }
    // The reset vector lands somewhere inside the image; the link base is
    // that address rounded down to the flash sector the image starts on.
    // Both candidate bases are 8 KB-aligned, so round to 8 KB.
    Some(reset_vector & !0x1FFF)
}

/// Refuse an image that is not linked for the bootloader we are about to
/// flash through. Rev A images start at `0x08000000`, rev B images at
/// `0x08002000`; writing one through the other's bootloader produces a
/// board that enumerates as nothing and needs a manual recovery.
fn check_image_matches_bootloader(
    firmware: &[u8],
    bootloader: &crate::flash::watcher::Bootloader,
) -> Result<(), AppError> {
    let Some(link_base) = image_link_base(firmware) else {
        // Not a recognisable vector table — leave it to the device.
        log::warn!("firmware has no recognisable Cortex-M vector table; skipping link-base check");
        return Ok(());
    };
    if link_base != bootloader.flash_base {
        return Err(AppError::BuildFailed(format!(
            "firmware is linked for 0x{link_base:08x} but the attached \
             bootloader {:04x}:{:04x} ({}) flashes at 0x{:08x}. This image \
             was built for the wrong Moonlander revision — flashing it would \
             leave the board unbootable.",
            bootloader.vid, bootloader.pid, bootloader.revision, bootloader.flash_base
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Primary backend: dfu-core + dfu-nusb
// ---------------------------------------------------------------------------

pub struct DfuNusbFlasher;

/// Marker put in the io::Error the progress reader raises on cancellation,
/// so it can be told apart from real USB/io failures.
const CANCEL_MARKER: &str = "qmk-flasher: cancelled";

/// Feeds firmware to dfu-core's download loop while reporting progress and
/// enforcing cancellation. dfu-core pulls one transfer-size chunk per
/// DFU_DNLOAD, so bytes read track bytes on the wire (one chunk ahead).
struct ProgressReader<'a> {
    data: &'a [u8],
    pos: usize,
    on_event: &'a mut dyn FnMut(FlashEvent),
    cancel: &'a CancelToken,
}

impl Read for ProgressReader<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                CANCEL_MARKER,
            ));
        }
        let remaining = &self.data[self.pos..];
        let n = remaining.len().min(buf.len());
        buf[..n].copy_from_slice(&remaining[..n]);
        self.pos += n;
        if n > 0 {
            let progress = self.pos as f32 / self.data.len() as f32;
            (self.on_event)(FlashEvent::Downloading { progress });
        }
        Ok(n)
    }
}

impl Flasher for DfuNusbFlasher {
    fn flash(
        &mut self,
        firmware: &[u8],
        on_event: &mut dyn FnMut(FlashEvent),
        cancel: &CancelToken,
    ) -> Result<FlashOutcome, AppError> {
        validate_firmware(firmware)?;

        let info = nusb::list_devices()
            .wait()
            .map_err(map_nusb_setup_error)?
            .find(|d| is_known_bootloader(d.vendor_id(), d.product_id()))
            .ok_or(AppError::DfuNotFound)?;
        // Safe to unwrap the lookup: `find` already matched a known id.
        let bootloader = find_bootloader(info.vendor_id(), info.product_id())
            .expect("device matched a known bootloader id");
        log::info!(
            "opening bootloader {:04x}:{:04x} ({}), flashing at 0x{:08x}",
            bootloader.vid,
            bootloader.pid,
            bootloader.revision,
            bootloader.flash_base
        );
        check_image_matches_bootloader(firmware, bootloader)?;
        let device = info.open().wait().map_err(map_nusb_setup_error)?;
        let interface = device
            .claim_interface(0)
            .wait()
            .map_err(map_nusb_setup_error)?;
        // Reads the DfuSe functional descriptor + interface string
        // ("@Internal Flash/0x08000000/..." on the STM32 ROM bootloader).
        let dfu = pollster::block_on(dfu_nusb::DfuNusb::open(device, interface, 0))
            .map_err(map_dfu_error)?;
        let mut dfu = dfu.into_sync_dfu();
        dfu.override_address(bootloader.flash_base);

        // dfu-core erases every needed page before the first chunk is sent;
        // it exposes no erase progress, so this phase is indeterminate.
        on_event(FlashEvent::Erasing { progress: None });

        let reader = ProgressReader {
            data: firmware,
            pos: 0,
            on_event: &mut *on_event,
            cancel,
        };
        // `Ok(None)` means the device already reset off the bus (the STM32
        // ROM bootloader is not manifestation tolerant); `Ok(Some)` means it
        // stayed — either way the manifest ("leave") has been issued.
        match dfu.download(reader, firmware.len() as u32) {
            Ok(_) => {
                on_event(FlashEvent::Leaving);
                Ok(FlashOutcome::Completed)
            }
            Err(e) if is_cancellation(&e) => Ok(FlashOutcome::Cancelled),
            Err(e) => Err(map_dfu_error(e)),
        }
    }
}

fn is_cancellation(e: &dfu_nusb::Error) -> bool {
    matches!(
        e,
        dfu_nusb::Error::StdIO(io)
            if io.kind() == std::io::ErrorKind::Interrupted
                && io.to_string().contains(CANCEL_MARKER)
    )
}

/// Errors while enumerating/opening/claiming, before any DFU traffic.
fn map_nusb_setup_error(e: nusb::Error) -> AppError {
    use nusb::ErrorKind;
    match e.kind() {
        ErrorKind::PermissionDenied | ErrorKind::Busy | ErrorKind::Unsupported => {
            AppError::DfuAccessDenied
        }
        ErrorKind::Disconnected | ErrorKind::NotFound => AppError::DfuNotFound,
        _ => AppError::DfuVerifyFailed(format!("USB setup failed: {e} (safe to retry)")),
    }
}

/// Errors from the DFU transaction itself. Mid-flash USB errors are mapped
/// to `DfuVerifyFailed`, whose hint tells the user retrying is safe.
fn map_dfu_error(e: dfu_nusb::Error) -> AppError {
    match e {
        dfu_nusb::Error::DeviceNotFound => AppError::DfuNotFound,
        dfu_nusb::Error::Nusb(inner) => map_nusb_setup_error(inner),
        other => AppError::DfuVerifyFailed(format!("{other} (safe to retry)")),
    }
}

// ---------------------------------------------------------------------------
// Fallback backend: bundled dfu-util.exe
// ---------------------------------------------------------------------------

/// Parse one line of `dfu-util -D` output into a [`FlashEvent`].
///
/// dfu-util prints `\r`-terminated progress bars like:
/// `Erase    [=========================] 100%        26164 bytes`
/// `Download [====                     ]  15%         4096 bytes`
/// and `Submitting leave request...` after a `:leave` download.
/// (Compiled unconditionally so the parser stays unit-tested even when the
/// `dfu-util-fallback` feature is off.)
pub fn parse_dfu_util_line(line: &str) -> Option<FlashEvent> {
    if line.contains("Submitting leave request") {
        return Some(FlashEvent::Leaving);
    }
    let percent = line.find('%').and_then(|idx| {
        let digits_start = line[..idx]
            .rfind(|c: char| !c.is_ascii_digit())
            .map(|i| i + 1)
            .unwrap_or(0);
        line[digits_start..idx].parse::<u32>().ok()
    })?;
    let progress = (percent.min(100)) as f32 / 100.0;
    if line.trim_start().starts_with("Erase") {
        Some(FlashEvent::Erasing { progress: Some(progress) })
    } else if line.trim_start().starts_with("Download") {
        Some(FlashEvent::Downloading { progress })
    } else {
        None
    }
}

#[cfg(feature = "dfu-util-fallback")]
pub use dfu_util_impl::DfuUtilFlasher;

#[cfg(feature = "dfu-util-fallback")]
mod dfu_util_impl {
    use super::*;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    use crate::flash::watcher::Bootloader;

    /// Which known bootloader is on the bus right now. dfu-util needs both
    /// its id (`-d`) and its flash base (`-s`), and those must come from the
    /// same device — a rev A address with a rev B board would brick it.
    fn attached_bootloader() -> Result<&'static Bootloader, AppError> {
        nusb::list_devices()
            .wait()
            .map_err(map_nusb_setup_error)?
            .find_map(|d| find_bootloader(d.vendor_id(), d.product_id()))
            .ok_or(AppError::DfuNotFound)
    }

    /// Shells out to `dfu-util.exe`. The executable is resolved from
    /// `QMK_FLASHER_DFU_UTIL` or, by default, `dfu-util.exe` next to the
    /// app binary / on PATH.
    pub struct DfuUtilFlasher {
        pub exe: PathBuf,
    }

    impl DfuUtilFlasher {
        pub fn from_env() -> Self {
            let exe = std::env::var_os("QMK_FLASHER_DFU_UTIL")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("dfu-util.exe"));
            Self { exe }
        }

        fn classify_failure(stderr: &str) -> AppError {
            let lower = stderr.to_lowercase();
            if lower.contains("no dfu capable usb device") {
                AppError::DfuNotFound
            } else if lower.contains("access") || lower.contains("libusb_error_access") {
                AppError::DfuAccessDenied
            } else {
                AppError::DfuVerifyFailed(format!(
                    "dfu-util failed: {} (safe to retry)",
                    stderr.trim()
                ))
            }
        }
    }

    impl Flasher for DfuUtilFlasher {
        fn flash(
            &mut self,
            firmware: &[u8],
            on_event: &mut dyn FnMut(FlashEvent),
            cancel: &CancelToken,
        ) -> Result<FlashOutcome, AppError> {
            validate_firmware(firmware)?;

            let bootloader = attached_bootloader()?;
            check_image_matches_bootloader(firmware, bootloader)?;
            let device_spec = format!("{:04x}:{:04x}", bootloader.vid, bootloader.pid);
            let address_spec = format!("0x{:08x}:leave", bootloader.flash_base);

            let tmp = std::env::temp_dir().join("qmk-flasher-firmware.bin");
            std::fs::write(&tmp, firmware).map_err(|e| {
                AppError::BuildFailed(format!("cannot stage firmware for dfu-util: {e}"))
            })?;

            let mut child = Command::new(&self.exe)
                .args(["-a", "0", "-d", &device_spec, "-s", &address_spec, "-D"])
                .arg(&tmp)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    AppError::DfuVerifyFailed(format!(
                        "cannot launch {}: {e} (safe to retry)",
                        self.exe.display()
                    ))
                })?;

            // dfu-util redraws its progress bars with '\r'; read raw bytes
            // and treat '\r' and '\n' both as line terminators.
            let mut stdout = child.stdout.take().expect("stdout piped");
            let mut line = String::new();
            let mut buf = [0u8; 256];
            let mut leaving_seen = false;
            loop {
                if cancel.is_cancelled() {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(FlashOutcome::Cancelled);
                }
                let n = stdout.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                for &b in &buf[..n] {
                    if b == b'\r' || b == b'\n' {
                        if let Some(event) = parse_dfu_util_line(&line) {
                            leaving_seen |= event == FlashEvent::Leaving;
                            on_event(event);
                        }
                        line.clear();
                    } else {
                        line.push(b as char);
                    }
                }
            }
            if let Some(event) = parse_dfu_util_line(&line) {
                leaving_seen |= event == FlashEvent::Leaving;
                on_event(event);
            }

            let status = child.wait().map_err(|e| {
                AppError::DfuVerifyFailed(format!("dfu-util did not exit cleanly: {e}"))
            })?;
            if status.success() {
                if !leaving_seen {
                    on_event(FlashEvent::Leaving);
                }
                Ok(FlashOutcome::Completed)
            } else {
                let mut stderr = String::new();
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut stderr);
                }
                Err(Self::classify_failure(&stderr))
            }
        }
    }
}

/// Backend selection: `QMK_FLASHER_DFU_BACKEND=dfu-util` picks the fallback
/// when it is compiled in; everything else gets the dfu-nusb backend.
pub fn default_flasher() -> Box<dyn Flasher + Send> {
    #[cfg(feature = "dfu-util-fallback")]
    {
        if std::env::var("QMK_FLASHER_DFU_BACKEND").as_deref() == Ok("dfu-util") {
            return Box::new(DfuUtilFlasher::from_env());
        }
    }
    Box::new(DfuNusbFlasher)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal Cortex-M image: initial SP in SRAM, reset vector `base+0x2BD`
    /// (the offset a real Moonlander build produced), padded to `len`.
    fn fake_image(base: u32, len: usize) -> Vec<u8> {
        let mut v = Vec::with_capacity(len);
        v.extend_from_slice(&0x2000_0400u32.to_le_bytes());
        v.extend_from_slice(&(base + 0x2BD).to_le_bytes());
        v.resize(len.max(8), 0xFF);
        v
    }

    fn bootloader(pid: u16) -> &'static crate::flash::watcher::Bootloader {
        find_bootloader(if pid == 0xdf11 { 0x0483 } else { 0x3297 }, pid).unwrap()
    }

    #[test]
    fn reads_link_base_from_the_vector_table() {
        assert_eq!(image_link_base(&fake_image(0x0800_0000, 1024)), Some(0x0800_0000));
        assert_eq!(image_link_base(&fake_image(0x0800_2000, 1024)), Some(0x0800_2000));
        // Not a vector table: SP outside SRAM, or reset vector outside flash.
        assert_eq!(image_link_base(&[0xFF; 64]), None);
        assert_eq!(image_link_base(&[]), None);
    }

    #[test]
    fn accepts_an_image_linked_for_the_attached_bootloader() {
        // rev A image through the rev A (STM32 ROM) bootloader.
        assert!(check_image_matches_bootloader(
            &fake_image(0x0800_0000, 1024),
            bootloader(0xdf11)
        )
        .is_ok());
        // rev B image through ZSA's bootloader.
        assert!(check_image_matches_bootloader(
            &fake_image(0x0800_2000, 1024),
            bootloader(0x2003)
        )
        .is_ok());
    }

    #[test]
    fn refuses_a_rev_a_image_through_the_rev_b_bootloader() {
        // Exactly the situation on hardware 2026-08-01: the app builds a
        // reva image (linked 0x08000000) while the board presents ZSA's
        // rev B bootloader, which flashes at 0x08002000.
        let err = check_image_matches_bootloader(
            &fake_image(0x0800_0000, 69_416),
            bootloader(0x2003),
        )
        .unwrap_err();
        assert_eq!(err.code(), "BuildFailed");
        let msg = err.to_string();
        assert!(msg.contains("0x08000000"), "{msg}");
        assert!(msg.contains("0x08002000"), "{msg}");
        assert!(msg.contains("3297:2003"), "{msg}");
    }

    #[test]
    fn refuses_a_rev_b_image_through_the_rev_a_bootloader() {
        let err = check_image_matches_bootloader(
            &fake_image(0x0800_2000, 1024),
            bootloader(0xdf11),
        )
        .unwrap_err();
        assert_eq!(err.code(), "BuildFailed");
    }

    #[test]
    fn unrecognisable_image_is_left_to_the_device() {
        // No vector table to check against — don't invent a verdict.
        assert!(check_image_matches_bootloader(&[0x00; 256], bootloader(0x2003)).is_ok());
    }

    #[test]
    fn firmware_validation_rejects_empty_and_oversized() {
        assert!(validate_firmware(&[]).is_err());
        assert!(validate_firmware(&vec![0u8; FLASH_CAPACITY + 1]).is_err());
        assert!(validate_firmware(&[0xFF; 1024]).is_ok());
    }

    #[test]
    fn progress_reader_reports_fractional_progress() {
        let data = vec![0u8; 100];
        let mut events = Vec::new();
        let cancel = CancelToken::default();
        let mut on_event = |e: FlashEvent| events.push(e);
        let mut reader = ProgressReader {
            data: &data,
            pos: 0,
            on_event: &mut on_event,
            cancel: &cancel,
        };
        let mut buf = [0u8; 40];
        assert_eq!(reader.read(&mut buf).unwrap(), 40);
        assert_eq!(reader.read(&mut buf).unwrap(), 40);
        assert_eq!(reader.read(&mut buf).unwrap(), 20);
        assert_eq!(reader.read(&mut buf).unwrap(), 0); // EOF, no event
        assert_eq!(
            events,
            vec![
                FlashEvent::Downloading { progress: 0.4 },
                FlashEvent::Downloading { progress: 0.8 },
                FlashEvent::Downloading { progress: 1.0 },
            ]
        );
    }

    #[test]
    fn progress_reader_stops_on_cancellation() {
        let data = vec![0u8; 100];
        let cancel = CancelToken::default();
        cancel.cancel();
        let mut on_event = |_e: FlashEvent| panic!("no events after cancel");
        let mut reader = ProgressReader {
            data: &data,
            pos: 0,
            on_event: &mut on_event,
            cancel: &cancel,
        };
        let mut buf = [0u8; 40];
        let err = reader.read(&mut buf).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::Interrupted);
        assert!(is_cancellation(&dfu_nusb::Error::StdIO(err)));
    }

    #[test]
    fn parses_dfu_util_progress_lines() {
        assert_eq!(
            parse_dfu_util_line(
                "Erase    [=========================] 100%        26164 bytes"
            ),
            Some(FlashEvent::Erasing { progress: Some(1.0) })
        );
        assert_eq!(
            parse_dfu_util_line(
                "Download [====                     ]  15%         4096 bytes"
            ),
            Some(FlashEvent::Downloading { progress: 0.15 })
        );
        assert_eq!(
            parse_dfu_util_line("Submitting leave request..."),
            Some(FlashEvent::Leaving)
        );
        assert_eq!(parse_dfu_util_line("dfu-util 0.11"), None);
        assert_eq!(parse_dfu_util_line(""), None);
        assert_eq!(parse_dfu_util_line("Download done."), None);
    }

    #[test]
    fn nusb_error_kinds_map_to_contract_errors() {
        // Constructed through the public mapping fn on synthetic errors is
        // not possible (nusb::Error has no public constructor), so map via
        // dfu_nusb wrappers we can build.
        let e = map_dfu_error(dfu_nusb::Error::DeviceNotFound);
        assert_eq!(e.code(), "DfuNotFound");

        let io = std::io::Error::other("bulk transfer failed");
        let e = map_dfu_error(dfu_nusb::Error::StdIO(io));
        assert_eq!(e.code(), "DfuVerifyFailed");
        assert!(e.to_string().contains("safe to retry"));
    }
}

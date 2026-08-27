//! AULA F75 support — a vendor-HID remapper, NOT a QMK target.
//!
//! The F75 cannot run QMK: it ships proprietary firmware on an 8051-class
//! vendor MCU, there is no upstream port, and its bootloader does not speak
//! DFU. So it is deliberately **not** in `shared/keyboards.json` — the
//! keyboard registry means "a board the QMK codegen/build/flash pipeline can
//! target", and adding the F75 there would require fabricating a
//! `qmkKeyboard`, a `layoutMacro` and a geometry file for a board that has
//! none. See `docs/research/aula-f75-feasibility.md`.
//!
//! **Phase 1 (this module today): geometry only.** Nothing here opens, reads
//! from, or writes to a USB device. The write path is not started and requires
//! sign-off on the exact bytes first.
//!
//! One finding that matters for the phase after this: the documented way to
//! *read* the board's config is a SET-then-GET — a request feature report is
//! **sent** before the response is read. So even "just reading" the F75 puts
//! bytes on the wire, and is gated behind the same sign-off as a write.

pub mod geometry;

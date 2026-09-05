---
status: draft
---

# AULA F75 remapper — transport decision and implementation plan

**Date:** 2026-08-27
**Status:** plan only. **No write-path code written.** Awaiting sign-off.
**Prerequisite:** [aula-f75-feasibility.md](./aula-f75-feasibility.md) — the F75 cannot
run QMK, so this is a *vendor-HID remapper* driving the stock firmware, not a
keyboard added to the QMK pipeline.

## 1. Transport: WebHID vs Rust-side HID

### Measured, not assumed

I probed our **actual** webview (temporary instrumentation, since reverted; tree is
clean). Tauri dev build, WebView2, `Chrome/151.0.0.0 Edg/151.0.0.0`:

```
inNav=true  type=object  req=function  getDev=function
usb=true  serial=true  bluetooth=true

getDevices=OK len=0
requestDevice=REJECTED SecurityError: Failed to execute 'requestDevice' on 'HID':
              Must be handling a user gesture to show a permission request.
```

**`navigator.hid` genuinely exists and is live in our webview.** This contradicts what
I expected going in, so recording it plainly: WebHID is *not* absent on Windows.
`getDevices()` really executes and returns 0 (correct — nothing has been granted yet),
and `requestDevice()` gets far enough to hit Chromium's user-gesture gate, which means
the API is wired rather than stubbed.

Corroborated upstream — [tauri-apps/tauri#14549](https://github.com/tauri-apps/tauri/issues/14549)
(closed 2025-11-23), maintainer **FabianLars**:

> "yes, and probably always was since the windows webview is based on chromium. this
> issue really is about the other platforms" … "I'm not aware of any restrictions
> compared to any other chromium based browser."

And maintainer **k26pl** on the same issue:

> "These are chromium-only apis, and are not supported on other webview engines which
> are used by tauri. A possible workaround would be using rust usb library."

### One thing I could NOT verify

Whether the **device chooser dialog actually appears** in our window. `requestDevice()`
requires a real user gesture; a synthetic click is not one, so this needs a human to
click a button in the app. It matters, because without a successful `requestDevice()`
grant, `getDevices()` returns `[]` forever and WebHID is inert. If we ever want to go
the WebHID route, that click test is the one remaining gate — I can wire a throwaway
button for Simon to click if he wants it settled.

### Recommendation: Rust-side `hidapi`. Reasons that survive the above.

WebHID working on Windows does **not** make it the right choice here:

1. **Portability.** `tauri.conf.json` sets `"targets": "all"`. WebHID does not exist in
   **WKWebView** (Apple declined it) or **WebKitGTK**. A WebHID remapper is
   Windows-only by construction; the Rust path is not. Tauri's own maintainers
   recommend "using rust usb library" for exactly this reason.
2. **We already have the dependency and the precedent.** `hidapi = "2"` is *already*
   in `src-tauri/Cargo.toml`, and `src-tauri/src/keyreport/mod.rs` is a working raw-HID
   client. **Zero new dependencies.**
3. **`keyreport` already documents the Windows lesson we would otherwise relearn:**
   > "every Moonlander interface binds to HidUsb (hidclass.sys), so `nusb` — which the
   > flashing code uses, and which speaks WinUSB — cannot open this channel at all."

   The F75 is likewise a HID-bound device selected by usage page. `hidapi` is the
   crate that already works for this shape; `nusb` provably is not.
4. **Contract fit.** `docs/CONTRACT.md`'s module rule — plain functions + callbacks,
   never `AppHandle`, pure logic unit-tested without hardware — is what makes a
   frame builder testable. A WebHID implementation puts byte-packing in the webview
   where it is hardest to test and easiest to get a wrong byte into.
5. **No chooser dependency.** Rust enumerates directly; no permission dialog, no
   gesture, no grant persistence problem.

## 2. Protocol — what is actually known, and what is NOT

All of this comes from reading community source, not from summaries. **Nothing below
is guessed, and no byte layout will be written to hardware unless this table says
VERIFIED.**

### Two variants, two *completely different* protocols

This is the single most dangerous fact for a write path:

| | wired **F75** | **F75 Max** |
| --- | --- | --- |
| VID:PID | `258A:010C` (SinoWealth) | `0C45:800A` (SONiX) |
| Transport | feature report `0x06`, **520-byte** blob | **64-byte** feature reports, usage page `0xFF13` usage `0x0001` |
| Remap shape | one 520-byte keybind blob per layer | `begin 04 18` → `prepare 04 11` → data → `apply 04 02` → `finish 04 F0` |
| Confidence | keybind offsets **doubly confirmed** vs F87 factory fixtures | partly **speculative** — `REMAP_CAPS_TO_ALT = 0x02  # speculative` |

**Plan: support the wired F75 (`258A:010C`) only.** The Max's remap sequence is
explicitly marked speculative in its own source and is a caps-lock-only proof of
concept, not a general keymap. Sending a wrong 64-byte control frame to an
undocumented 8051 control interface is exactly the "wrong HID write" risk. The Max is
out of scope until someone verifies it on hardware they are willing to lose.

Also out of scope: the **dongle** (`3554:FA09`, 20-byte output report `0x13` with a
sum-checksum). Different transport again; wired-only keeps the surface honest.

### The keybind blob (wired F75) — the one write we would ever do

Feature report `0x06`, 520 bytes. Note WebHID strips byte 0; **`hidapi` on Windows
does not** — `send_feature_report` expects the report ID as byte 0. That off-by-one is
the most likely way to corrupt a write, and it is the reason the frame builder must be
a pure, golden-tested function.

| offset | size | meaning |
| --- | --- | --- |
| 0 | 1 | report id `0x06` |
| 1 | 1 | `0x03` constant |
| 2 | 1 | layer: `0x00` base, `0x01` FN1 |
| 3,4,5 | 3 | `0x00`, `0x01`, `0x00` |
| 6–7 | 2 | `0x00`, `0xff` |
| 8 + 4·i | 1 | slot i output **page** |
| 9 + 4·i | 2 | reserved `0x00 0x00` |
| 11 + 4·i | 1 | slot i **usage id** |
| 518–519 | 2 | trailer `5A A5` |

Pages: `0x00` = HID usage page `0x07` (keyboard), `0x02` = usage page `0x0C`
(consumer/media). Unbound = page `0x00`, usage `0x00`. Slots `0..126`; slot 127 would
overlap the trailer. **F1–F12 are firmware-locked** at matrix indexes
`[12,18,24,30,36,42,48,54,60,66,72,78]` and must be refused client-side, not attempted.

### Known-unknowns — explicitly not to be attempted

- **Macros:** undocumented for the F75. Upstream sets `MACRO_SUPPORTED = false`. Not in scope.
- **Colour table display:** writes persist byte-exact but the self-define select value
  is marked **UNSOLVED / UNCONFIRMED**. Lighting is not in scope for a keymap feature.
- **Effect numbering quirk** is only PARTIALLY VERIFIED. Not in scope.
- `AmoabaKelvin/aula-f75-configurator` — I cloned it; the repo is **empty**. It is not
  a corroborating source and I am not counting it as one.

### Safety facts worth having on record

- **Recovery exists:** holding `Fn+Esc` ~5 s performs a board-wide factory reset
  (VERIFIED by the upstream project on live hardware). This is our undo.
- The tri-mode side switch mutes the USB data lines in wireless positions — the board
  will not enumerate over USB unless set to wired. Expect "device not found" reports
  that are really switch position.
- USB hubs caused flaky enumeration upstream; root ports were reliable.

## 3. Geometry — derivable from a real source, not fabricated

The OEM Windows installer contains `app/Dev/kb/<variant>/KB.ini`, extracted with
`innoextract`. `[KEY]` gives one line per key:

```
;Esc
K1=30,30,55,57, 0x02,0x1B,0x00,0
;F1
K2=107,30,132,57, 0x02,0x70,0x00,12
```

81 entries for the F75 KR, carrying pixel geometry, a Windows VK code, and the
**matrix index** — and those indices (`0, 12, 18, 24, 30, 36…`) independently
corroborate the locked-F1–F12 list above. This is a real vendor source, directly
analogous to `extract-geometry.mjs` reading QMK's `keyboard.json`. **No fabrication
required.**

Two caveats to handle rather than assume away:

- Upstream's provenance note labels the fields `x,y,w,h`, but the values read as
  `left,top,right,bottom` (Esc `30,30,55,57` → 25×27). **Derive the convention from
  the data, don't trust the label.**
- The file is extracted from a proprietary installer. Shipping it verbatim in-repo is
  a **licensing call for Simon**, not mine. Alternative: ship a derived geometry JSON
  plus an extractor script the user points at their own installer — which is exactly
  the `extract-geometry.mjs` pattern we already use for QMK.

## 4. The product problem nobody has flagged yet

The F75 keymap model is **drastically weaker** than the Moonlander's, and our
`LayoutFile` schema mostly cannot be expressed on it:

| our schema | F75 |
| --- | --- |
| 8 layers | **2** (base + FN1) |
| tap/hold, tap-dance, QK_LOCK | none — a slot is one HID page + usage, nothing more |
| combos | none |
| per-key `glow` in the layout | separate colour-table protocol, display path UNSOLVED |
| macros | undocumented, unsupported |
| all 72 keys remappable | F1–F12 firmware-locked |

So this should **not** reuse `LayoutFile`. Forcing it would either silently drop
features or imply the F75 can do things it cannot. Proposal: a distinct, smaller
`F75Layout` type (2 layers × 80 slots of `{page, usage}`) with its own storage, and a
shared key-grid UI component. The keyboard registry stays QMK-only; the F75 is a
sibling feature, not a registry row.

## 5. Phased plan (read-only first, writes gated)

**Phase 0 — read-only, zero risk.** `src-tauri/src/aula/` module: enumerate
`258A:010C` by usage page, `get_feature_report` the config region via the VERIFIED
SET-then-GET, dump raw bytes to the UI. Pure frame *parsers* unit-tested against
fixtures. Nothing is written to the device. This also confirms Simon's specific unit
matches the documented layout before we ever build a write frame.

**Phase 1 — geometry + read-only UI.** Extractor for `KB.ini` → `f75_geometry.json`;
key grid renders the current mapping read from the board.

**Phase 2 — write path. Not started, and not to be started on this plan alone.**
Gated on:
1. Phase 0 read-back on Simon's actual hardware matching the documented layout.
2. Golden tests pinning every byte of the 520-byte blob, including the report-ID
   byte-0 difference between `hidapi` and WebHID.
3. Write → read-back → **diff verification** on every write, refusing to report
   success unless the board echoes what we sent.
4. Refusing locked F1–F12 slots and out-of-range slots client-side.
5. An explicit in-app confirmation, and `Fn+Esc` recovery documented in the UI.

## 6. What I need from Simon

1. **Go/no-go** on the Rust-side transport (evidence above says yes; WebHID does work
   on Windows but is Windows-only).
2. **Which board does he physically have** — F75 wired, F75 Max, or the dongle? The
   plan covers wired `258A:010C` only, and the Max's protocol is a different and
   partly speculative one. This determines whether the feature is buildable at all.
3. **Licensing call** on shipping OEM-derived geometry vs an extractor script.
4. Confirmation that a **separate `F75Layout`** (not `LayoutFile`) is the right call.

## Sources

- Probe: this repo's own Tauri/WebView2 dev build, 2026-08-27 (instrumentation reverted)
- [tauri-apps/tauri#14549](https://github.com/tauri-apps/tauri/issues/14549) — maintainer statements on WebHID per platform
- [cloudglides/aula-f75-linux-drivers](https://github.com/cloudglides/aula-f75-linux-drivers) — `docs/PROTOCOL.md`, `web/src/lib/keybind.ts`, OEM `KB.ini` + `PROVENANCE.md`
- [Ghost-CR/F75_Initializer](https://github.com/Ghost-CR/F75_Initializer) — `windows_remap_test.py` (F75 Max control sequence, incl. its `# speculative` marker)
- [vndarkblue/aula-keybind](https://github.com/vndarkblue/aula-keybind), [marcoslor/Aula-F87-Controller](https://github.com/marcoslor/Aula-F87-Controller) — upstream attribution for the keybind/lighting formats

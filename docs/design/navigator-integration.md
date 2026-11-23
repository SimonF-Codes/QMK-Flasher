---
status: draft
---

# Design proposal: optional ZSA Navigator on the Moonlander

Status: **draft** (Alpha, 2026-11-23). Not implemented. Simon has a Navigator
and will 3D-print the mount; the shells themselves are separate work.

## Where the project stands first

`main` @ `66133e0`. 588 vitest / 195 cargo green, tsc clean, `vite build`
clean. Public, GPL-2.0-or-later. Four commits ahead of `origin` as of writing.

Shipped and working:

| Area | State |
|---|---|
| Layout editing | layers, keycodes, mod-taps, dual-function, tap dance, per-key LED |
| Macros | authored in-app; 7 Oryx-seeded ones round-trip unchanged |
| Combos | authored in-app; `>= 2` distinct keys enforced |
| OS-aware keys | `osMacro` per-OS halves, `QF_OS_*` mode keys, host OS detection |
| Lighting | static ledmap **and** reactive brightness over it; `applyOnBoot` |
| Mirror | layer mirroring derived from geometry; `TG(5)` on the base layer |
| Tool Guide | printable reference derived from the layout, with swap analysis |
| Tutorial | 16-step tour, steps derived from the layout |
| Build & flash | real QMK build, DFU (`0483:df11`, ZSA `3297:2003`), rev B |
| Schema | v5, additive, migrated on load, skew named rather than blamed |
| AULA F75 | read-only grid only; not QMK-capable, writes gated (see `research/`) |

> [!warning] The standing gap is hardware, not software
> Nothing from the reactive-lighting work onward has been flashed. The
> firmware compiles and the symbols are verified in the ELF, but "builds" and
> "behaves on the board" are different claims.

## Problem

The Navigator is a pointing module — trackball or trackpad — that ZSA sells
for the Voyager. It is **officially usable on the Moonlander**, and ZSA says
so in their own words:

> The Navigator is fully compatible with the Moonlander using a core and
> 3D-printed shell.
> — zsa.io/navigator

Two things follow, and both are load-bearing.

**It is not a USB mouse.** ZSA: *"To create the Navigator we had to develop an
entirely new pointing device driver in QMK"*, and *"the Navigator is
compatible with any QMK keyboard that supports I2C"*. The module talks I2C to
the keyboard; the keyboard's firmware drives it and reports the motion. So
this app — which owns the firmware — has to opt in, or the hardware does
nothing.

**There is no official Moonlander shell.** ZSA: *"there won't be an official
ABS-molded shell for the Moonlander or ErgoDox EZ."* Simon prints his own, and
will be testing **several mount positions**. That is the fact that shapes the
whole design: the mount orientation is not decided once, it is iterated.

## What the firmware actually needs

Verified against `C:\Users\fridl\qmk_firmware` (ZSA's fork, branch
`firmware25`). The drivers ship as **QMK community modules**, not sensor
drivers:

```
modules/zsa/navigator_trackball/   navigator.c, navigator_trackball.{c,h}
modules/zsa/navigator_trackpad/    navigator_trackpad*.{c,h}
```

`navigator_trackball/rules.mk` is the whole story of what enabling it costs:

```make
POINTING_DEVICE_DRIVER = custom
I2C_DRIVER_REQUIRED = yes
SRC += $(MODULE_PATH_NAVIGATOR_TRACKBALL)/navigator.c
```

So the opt-in is a **module declaration**, and we already emit the file it
goes in. `codegen/mod.rs` writes `keymap.json` from a hardcoded constant:

```rust
const KEYMAP_JSON: &str = "{ \"modules\": [ \"zsa/oryx\", \"zsa/defaults\" ] }";
```

That constant has to become derived. It is the only structural change.

### The knobs, from the module headers

| Define | Default | Why it matters here |
|---|---|---|
| `NAVIGATOR_TRACKBALL_ROTATION` | `0` | **degrees, `% 360`** — the per-shell setting |
| `NAVIGATOR_TRACKBALL_CPI` | `40` | max `125`, tick `5` — pointer speed |
| `NAVIGATOR_TRACKBALL_ADDRESS` | `0x50` | I2C address |
| `NAVIGATOR_TRACKBALL_TIMEOUT` | `100` | probe/read timeout |
| `NAVIGATOR_SCROLL_DIVIDER` | `10` | drag-scroll feel |
| `NAVIGATOR_SCROLL_ACCELERATION` | `1.5f` | |
| `NAVIGATOR_SCROLL_MAX_SPEED` | `8.0f` | |
| `NAVIGATOR_SCROLL_INVERT_X/Y` | unset | |
| `NAVIGATOR_TURBO_MULTIPLIER` | `3` | |
| `NAVIGATOR_AIM_DIVIDER` | `3` | |

### Keycodes the module handles

From `process_record_navigator_trackball`: `NAVIGATOR_INC_CPI`,
`NAVIGATOR_DEC_CPI`, `NAVIGATOR_TURBO`, `TOGGLE_TURBO`, `NAVIGATOR_AIM`,
`TOGGLE_AIM`, `DRAG_SCROLL`, `TOGGLE_SCROLL`, `TOGGLE_SCROLL_VERTICAL`,
`NAVIGATOR_CLEAR_SPEED`. These belong in `shared/keycodes.json` under a new
category so the key picker can place them.

## Decisions

### Rotation is a first-class setting, not a config field

**Because the shells are being iterated, rotation is the setting that changes
most often and the one a wrong value makes most obviously wrong** — the
pointer goes sideways. It should be a visible control with a live preview of
which way "up" ends up, not a number buried in an advanced panel.

Rejected: hardcoding a rotation per side. The point of printing several shells
is that orientation is not a function of the side.

### Which half does *not* need split pointing

The Moonlander declares **no `split`** in its `keyboard.json` — it is one
controller addressing both halves, not a QMK split keyboard. So
`SPLIT_POINTING_ENABLE` / `POINTING_DEVICE_LEFT|RIGHT` do not apply, and
`pointing_device.c:38` would error if they were set without split.

> [!note] Which half you mount it on changes the rotation you want, not the transport.
> This is a real simplification, and the opposite of what the Voyager
> documentation implies, because the Voyager *is* a split board.

### Trackball and trackpad are separate modules, not one setting

They are different modules with different manifests — the trackball declares
`features.pointing_device`, the trackpad declares `features.digitizer`. ZSA
allows one of each simultaneously (as of August 2026). So the setting is
"which modules are attached", not an enum of one.

### Firmware size is the live risk

`POINTING_DEVICE_ENABLE` plus an I2C driver plus a mouse layer is not free,
and the current build is ~62 KB against a limit that has not been measured.
Any implementation must report the size both ways.

## Open questions

> [!question] For Simon
> 1. **Trackball, trackpad, or both?** The search said you have the Navigator
>    — which module is it?
> 2. **Which half** are you mounting it on first?
> 3. **Should the app ship rotation presets** named after your printed shells
>    (e.g. "thumb-left 45°"), so switching shells is one pick rather than a
>    number you have to remember?
> 4. Do you want the **mouse layer auto-created** the way Oryx does it, or
>    placed by hand?

## Not in scope here

The 3D models for the mount. Simon named that as separate work, and it is a
different kind of artifact from anything in this repo.

Links: [[Personal/Code/Code Index|Code Index]]

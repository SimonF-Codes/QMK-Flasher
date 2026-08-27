# AULA F75 — exact bytes, pending Simon's sign-off

**Date:** 2026-08-27
**Status:** NOTHING HAS BEEN SENT TO ANY DEVICE. No code in this repo opens,
reads from, or writes to a USB device. This document exists to be approved
before that changes.

Scope: the wired F75 only (`258A:010C`). The F75 Max (`0C45:800A`) speaks a
different protocol whose remap sequence its own source marks speculative, and
the dongle (`3554:FA09`) is a third transport. Neither is covered here.

**Bottom line up front:** sequence 1 (config read) is fully determined and I
would send it as written. **Sequence 2 (keybind write) is not ready, and I
recommend not approving it yet** — investigating it turned up three
demonstrable errors in the documented layout plus a structural hazard. Details
in §2. There is a safe intermediate step (§3) I would rather do first.

---

## 0. Why a read needs sign-off too

The documented way to read this board is **SET-then-GET**: a request feature
report is *sent*, then the reply is read back. A bare GET returns flash/status
noise. So "just reading" the F75 puts bytes on the wire, and by our rule that
makes it a write. Both sequences below are gated.

Transport note that changes the bytes: **WebHID strips byte 0**, so upstream's
`sendFeatureReport(0x06, frame.slice(1))` puts 519 bytes on the wire with the
report ID carried out-of-band. **`hidapi` does not** — its
`send_feature_report` expects the report ID as byte 0 of the buffer. Every
sequence below is written as the **full 520-byte hidapi buffer**, report ID
included. Getting this wrong shifts every field by one byte, which is the
single most likely way to corrupt a write.

---

## 1. Config read handshake — APPROVED-READY

Derived from the upstream implementation (`web/src/lib/f75.ts`, `buildFrame` /
`readRegion`), not from prose. Confidence: high — the code and the protocol
notes agree, and it is marked VERIFIED against live hardware upstream.

### 1a. The SET half — 520 bytes

```
offset 0    1    2    3    4    5    6    7    8 ................ 519
      06   84   00   00   01   00   80   00   00 00 00 ... 00 00 00
```

| bytes | value | reasoning |
| --- | --- | --- |
| `[0]` | `06` | Feature report ID. Present because hidapi wants it in the buffer; WebHID would omit it here and pass it separately. |
| `[1]` | `84` | Command: read region. The write counterpart is `04`; the high bit distinguishes read from write (`0a` write colours / `8a` read colours follow the same rule). |
| `[2..5]` | `00 00 01 00` | Region address. The config region and the colour table share this address — they are told apart by the length field, not the address. |
| `[6..7]` | `80 00` | Length, **little-endian** → `0x0080` = 128 bytes. This is what selects the 128-byte config region rather than the 512-byte colour table. |
| `[8..519]` | all `00` | Payload, unused in a read request. |

Exactly **4 non-zero bytes** in the whole 520-byte buffer.

### 1b. The GET half

Read one 520-byte feature report back. The 128-byte config region is at
`[8..136)`. Nothing is written in this half.

### 1c. What we would do with it

Nothing but display it. Reading the config region tells us whether Simon's
actual unit matches the documented layout **before** any write frame is ever
constructed — it is the cheapest possible reality check, and it is why I want
this one approved first and on its own.

Risk: low. It is a read command against a documented address, the reply is
displayed and discarded, and no state is modified. The failure mode is a
timeout, which upstream already handles by retrying three times.

---

## 2. Keybind blob write — **NOT READY, recommend withholding approval**

The frame, for the record:

```
offset 0    1    2    3    4    5    6    7    8 .......... 517  518  519
      06   03  LYR   00   01   00   00   02   <-- 510 payload -->  5a   a5
```

| bytes | value | reasoning |
| --- | --- | --- |
| `[0]` | `06` | Feature report ID, as above. |
| `[1]` | `03` | Command: write keybind region. Same slot in the frame as `04`/`84` above. |
| `[2]` | `00` base, `01` FN1 | Selects the layer. Structurally this is address byte 0 — see below. |
| `[3..5]` | `00 01 00` | Rest of the region address, i.e. the whole address is `LYR 00 01 00`. |
| `[6..7]` | `00 02` | Length little-endian → `0x0200` = 512. **See discrepancy A.** |
| `[8+4i]` | page | Per-slot output page. |
| `[9+4i]` | modifiers | **See discrepancy B — this is NOT reserved.** |
| `[10+4i]` | ? | Usually `00`; non-zero in some vendor bindings. Unexplained. |
| `[11+4i]` | usage | Per-slot usage id. |
| `[518..519]` | `5a a5` | Trailer. Consistent across both factory captures. |

Reading `[1..7]` as `CMD, ADDR0..3, LEN_LO, LEN_HI` makes this the *same* frame
shape as the config read in §1 — which is a much more coherent account than the
protocol notes' "layer byte at offset 2, then constants". That reinterpretation
is what exposed the following.

### Discrepancy A — the documented header byte is wrong

The protocol notes say `[6]=0x00, [7]=0xff`, and upstream's `emptyBlob()`
writes exactly that. **Both factory captures say `00 02`:**

```
factory-base  06 03 00 00 01 00 00 02
factory-fn    06 03 01 00 01 00 00 02
emptyBlob()   06 03 LYR 00 01 00 00 ff   <-- disagrees at byte 7
```

`00 02` little-endian is `0x0200` = 512 = exactly the payload size, consistent
with §1's length field. `0xff` fits nothing. Upstream's own `validateBlob()`
checks bytes 0, 1, 3, 4 and 5 but **not** 6 or 7, so this disagreement passes
its tests silently.

### Discrepancy B — "reserved 0x00 0x00" is a modifier bitmask

The notes describe each slot as `page, 0x00, 0x00, usage`. In the factory base
blob, seven slots have a non-zero second byte, and they are exactly the seven
modifier keys:

| slot | bytes | reading |
| --- | --- | --- |
| 4 | `00 02 00 00` | LShift |
| 5 | `00 01 00 00` | LCtrl |
| 11 | `00 08 00 00` | LGui |
| 17 | `00 04 00 00` | LAlt |
| 53 | `00 40 00 00` | RAlt |
| 82 | `00 20 00 00` | RShift |
| 83 | `00 10 00 00` | RCtrl |

That is the standard HID modifier byte (bit 0 LCtrl … bit 6 RAlt), with usage
`00`. It also explains compound bindings: FN1 slot 24 is `00 04 00 2b` =
**Alt+Tab**, and slot 30 is `00 04 00 29` = Alt+Esc.

**This matters because upstream's `vkmap` encodes modifiers the other way** —
LShift as `page 0x00, usage 0xE1`. So a blob generated from that table differs
from the factory on *every modifier key*, and nobody knows which form the
firmware honours. Writing the untested form to all seven modifiers on a first
write is not a risk worth taking blind.

### Discrepancy C — the page byte takes more values than documented

The notes list page `0x00` (HID keyboard) and `0x02` (HID consumer). The
factory FN1 blob's page bytes are `0x00` ×93, `0x02` ×10, **`0x07` ×11 and
`0x08` ×13**.

This also resolves something I flagged in Phase 1: **KB.ini's packed 32-bit
value is the slot's four bytes verbatim**, not a category+usage pair. 24 of the
30 F75 `[FN1]` packed values occur byte-for-byte as slots in the factory blob —
`0x0004002B` *is* `00 04 00 2b`, Alt+Tab. Keeping the raw packed value in the
geometry rather than synthesising a page/usage pair turns out to have preserved
exactly the information this depends on.

### The structural hazard — the blob is a whole-layer image

There is no partial write. Sending a keybind blob replaces **every slot on that
layer**. A frame with one intended remap and zeros elsewhere unbinds the entire
layer.

So a first write needs a correct 512-byte baseline, and we do not have one:

- **There is no captured F75 blob anywhere.** The only two captures are from
  the **F87**, a different board, and upstream's own fixture README says they
  are used "ONLY to cross-check blob structure" and that F75 default content is
  *reconstructed*, not captured.
- **No keybind read command is documented**, so we cannot ask the board.
- Reconstructing from KB.ini means trusting the `vkmap`, which discrepancy B
  shows disagrees with the factory on every modifier.
- One more trap: that table maps the Fn key's VK to *unbound*. If the firmware
  honours it, a reconstructed blob could unbind Fn — and `Fn+Esc` is our
  documented recovery. I have not verified whether the blob can affect Fn at
  all, but "our undo is on the list of things this write might disable" is
  reason enough to stop.

### If it were approved anyway

The single change would be CapsLock (slot 3) → LeftCtrl, base layer, with all
other slots at their factory values. The one slot differs by encoding:

```
factory/mask form   slot 3 = 00 01 00 00      (modifier bit, usage 0)
vkmap/usage form    slot 3 = 00 00 00 e0      (usage 0xE0)
```

The factory evidence favours the mask form. I cannot fill the other 126 slots
truthfully, which is the whole problem.

---

## 3. What I would rather do first

Try a **keybind read**. The command set is `04`/`84` write/read for config and
`0a`/`8a` for colours, so `03`/**`83`** for the keybind region is the obvious
candidate:

```
offset 0    1    2    3    4    5    6    7    8 ................ 519
      06   83   00   00   01   00   00   02   00 00 00 ... 00 00 00
```

Same shape as §1a: command `83`, address `00 00 01 00` (byte 2 = layer), length
`0x0200` = 512.

This is a **guess about the command byte**, and I am labelling it as one. It is
low risk — the high bit marks a read throughout this protocol, and an
unsupported command times out rather than writing — but it is not documented,
so it needs its own explicit approval and should not be lumped in with §1.

If it works, it gives us the real F75 factory baseline, settles discrepancies
A, B and C against Simon's actual hardware, and turns the write in §2 from
reconstruction into a one-slot edit of a known-good blob. That is the
difference between a first write we can verify and one we are hoping about.

---

## 4. What I am asking for

Three separate decisions, not one:

1. **§1 config read** — I recommend approving. Fully determined, low risk,
   tells us whether Simon's unit matches the documentation at all.
2. **§3 keybind read (`83`)** — I recommend approving *as an experiment*, on
   the understanding that the command byte is inferred, not documented.
3. **§2 keybind write** — I recommend **not** approving yet. It should wait
   until §3 either succeeds (giving a real baseline) or fails (in which case
   the reconstruction route needs verifying some other way first).

And still outstanding from before: **which board Simon physically has.**
Everything here assumes the wired F75 at `258A:010C`. If his is the Max, none
of these bytes apply.

## Sources

- `web/src/lib/f75.ts` (`buildFrame`, `readRegion`, `readConfigRegion`) — §1
- `web/src/lib/keybind.ts`, `web/src/lib/webhid.ts` (`writeKeybindBlob`) — §2
- `web/tests/fixtures/factory-base.bin`, `factory-fn.bin` + their README — the
  ground truth behind discrepancies A, B and C, and the F87 provenance
- `web/src/lib/vkmap.ts` — the conflicting modifier encoding
- `assets/oem/Dev/kb/1/KB.ini` `[FN1]` — the packed-value-is-slot-bytes finding
- all from [cloudglides/aula-f75-linux-drivers](https://github.com/cloudglides/aula-f75-linux-drivers),
  which credits [vndarkblue/aula-keybind](https://github.com/vndarkblue/aula-keybind) (MIT)
  for the keybind format and factory templates

---
name: bluetooth-classic
description: Bluetooth BR/EDR (Classic) reconnaissance and exploitation — SDP service/profile enumeration, brute-forcing non-discoverable devices, KNOB encryption-key-entropy downgrade, BIAS authentication bypass, BlueBorne-class proximity RCE, and HID profile spoofing for keystroke injection. Distinct stack from BLE (see ble-gatt) — no GATT/ATT, uses SDP/RFCOMM/L2CAP/HID over BR/EDR.
allowed-tools: Bash Read Write
metadata:
  subdomain: iot
  when_to_use: "bluetooth classic, BR/EDR, SDP, RFCOMM, L2CAP, KNOB, BIAS, BlueBorne, HID spoofing, non-discoverable device, redfang, bluediving, hcitool, sdptool, l2ping, bdaddr"
  tags: bluetooth, br-edr, sdp, knob, bias, blueborne, hid, iot, embedded
  mitre_attack: T1040, T1557, T1203
---

# Bluetooth Classic (BR/EDR) Reconnaissance and Exploitation

> Bluetooth Classic (BR/EDR) is a different protocol stack from Bluetooth
> Low Energy: no GATT, no ATT. Device/profile metadata is advertised via
> SDP; RFCOMM and L2CAP carry profile traffic (serial port, OBEX, HID,
> A2DP, handsfree). Use `ble-gatt` for BLE peripherals — this skill is
> for Classic-only or dual-mode devices operating in BR/EDR mode.

## Prerequisites

- Linux host with a BR/EDR-capable adapter (`hciconfig` shows `BR/EDR`
  in `Features`; most internal laptop and USB dongles support it).
- Tools: `bluez` (`hcitool`, `sdptool`, `bluetoothctl`, `l2ping`,
  `rfcomm`), `bluediving` (classic pentest framework: `btscanner`,
  carwhisperer-style audio, L2CAP fuzzing), `redfang` (`fang` —
  brute-forces BD_ADDR of non-discoverable devices).
- Passive capture (optional, needed for KNOB/BIAS MITM work): Ubertooth
  One with `ubertooth-btbr` firmware, or a modified CSR/BCM dongle
  running the vendor-specific sniffing firmware used in the published
  KNOB/BIAS research repos.

## Phase 1: Discovery — including non-discoverable devices

```bash
# Standard discoverable scan.
hcitool scan
bluetoothctl
  scan on

# Inquiry with extended info (EIR: vendor name, class of device).
hcitool inq --flush --length=10
```

Many targets set "non-discoverable" (hidden from inquiry scans) but stay
**connectable** — this hides them from the above, not from a direct
connection attempt if the BD_ADDR is known or guessable:

```bash
# redfang brute-forces the last N bytes of BD_ADDR for a known OUI
# (vendor prefix, e.g. from a paired phone/headset you already enumerated).
fang -r 00:1A:7D:00:00:00-00:1A:7D:FF:FF:FF -s

# Or probe a specific candidate address directly with l2ping —
# connectable non-discoverable devices still answer L2CAP echo.
l2ping -c 1 <BD_ADDR>
```

## Phase 2: SDP Service / Profile Enumeration

SDP (Service Discovery Protocol) is the Classic equivalent of GATT's
service table — it is queried **before** any pairing or authentication.

```bash
# Browse every advertised service record.
sdptool browse <BD_ADDR>

# Dump raw records (profile UUIDs, RFCOMM channel numbers, vendor strings).
sdptool records <BD_ADDR>

# Targeted profile checks — HID, OBEX push, serial port, handsfree.
sdptool search HID <BD_ADDR>
sdptool search OPUSH <BD_ADDR>
sdptool search SP <BD_ADDR>
```

SDP responses routinely leak the device's firmware/vendor string and the
exact RFCOMM channel a profile listens on — note both; most Classic
profile exploits (OBEX directory traversal, SPP shells, HID injection)
target a specific channel discovered here.

## Phase 3: KNOB — encryption key entropy downgrade (CVE-2019-9506)

The pairing handshake negotiates encryption key **length** in the clear
and unauthenticated; the Bluetooth Core spec permits negotiating it down
to 1 byte. An on-path attacker forces both ends to accept 1-byte entropy,
then brute-forces the resulting session key offline (2^8 space) and
decrypts/injects into the session. Requires on-path MITM capability
during pairing — practical with the KNOB PoC repo's modified firmware on
supported dongles, not with stock `bluez`.

- Confirm exposure first: `hcitool` against the target's chipset/firmware
  version from SDP (Phase 2) against the CVE-2019-9506 affected-vendor
  list before investing in the MITM rig.
- Impact once key entropy is forced to 1 byte: full session decrypt +
  injection, not just eavesdropping.

## Phase 4: BIAS — Bluetooth Impersonation AttackS (CVE-2020-10135)

Exploits the lack of mandatory mutual authentication in the legacy
Secure Connections role-switch path: an attacker impersonates a
previously-bonded device (e.g. a paired phone) to a target **without**
knowing the original link key, by forcing a downgrade to legacy
authentication and completing only the attacker-controlled half of the
handshake. Practical outcome: reconnect as a trusted peer to a device
that still holds the victim's bonding record, then re-run Phase 2/5/6
against it with the elevated trust level that bonding grants (unlocks
SDP services and HID pairing that require "trusted" status).

## Phase 5: BlueBorne-class proximity RCE (CVE-2017-0781 / -0782 / -0785 / -14315 family)

Pre-pairing, no-user-interaction remote code execution in the BR/EDR
stack itself (L2CAP/SDP/BNEP parsing, or the Android BNEP/PAN
implementation) — exploitability depends entirely on the target's patch
level. Workflow:

1. Fingerprint stack + OS/kernel version via SDP vendor strings (Phase 2)
   and `hcitool info <BD_ADDR>`.
2. Cross-reference against the CVE-2017-0781/0782/0785/14315 affected
   version table before attempting — these are stack-specific memory
   corruption bugs, not a generic technique; an unaffected patch level
   means this phase is a dead end, move to Phase 3/4/6 instead.
3. If affected and in scope: use the published BlueBorne research PoC
   for the matching CVE/stack. Treat as a crash-first exercise — capture
   a reproducible PoC and escalate to RCE only once stability is proven,
   per `exploit-dev` crash-analysis norms.

## Phase 6: HID profile spoofing — keystroke injection

Once bonded as a trusted peer (directly, or via Phase 4's impersonation),
register a Human Interface Device (HID) profile and inject keystrokes
exactly as a BadUSB payload would, but over the air:

```bash
# Register an HID service record via sdptool, then drive it with
# raw uinput events proxied over the RFCOMM/L2CAP HID channel.
sdptool add HID

# Inject events through the kernel's uinput layer — bluez delivers them
# to the target as if from a bonded physical keyboard once the profile
# handshake completes.
python3 - <<'EOF'
import uinput
events = (uinput.KEY_ENTER, uinput.KEY_A, uinput.KEY_B)
device = uinput.Device(events)
device.emit_click(uinput.KEY_A)
EOF
```

Payload content follows the same tradecraft as any keystroke-injection
attack (open a terminal, drop a stager, exfil) — the delivery channel is
the only novel part here.

## Evidence

```bash
EVIDENCE="/workspace/evidence/bluetooth-classic/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$EVIDENCE"
sdptool records <BD_ADDR> > "$EVIDENCE/sdp_records.txt"
sha256sum "$EVIDENCE/sdp_records.txt" >> "$EVIDENCE/sha256.txt"
```

Knowledge graph observation for a confirmed finding (e.g. HID takeover):

```python
kg_record(
    '[{"kind": "Finding", "key": f"bt-classic::{bd_addr}",'
    '  "label": f"Bluetooth Classic HID takeover {bd_addr}",'
    '  "props": {"cve_ids": [],'
    '            "bd_addr": bd_addr,'
    '            "technique": "hid-profile-spoof",'
    '            "requires_bond": true,'
    '            "severity": "high",'
    '            "source": "bluez+uinput"}}]'
)
```

## OPSEC Notes

- Inquiry scans (`hcitool scan`) are loud and logged by any BT-aware
  monitoring; prefer `redfang`/`l2ping` against a known/guessed BD_ADDR
  when the posture requires quiet.
- Repeated failed pairing attempts (Phase 4/6) can trigger a lockout or
  a notification on the victim device — budget for a limited number of
  attempts per engagement window, same discipline as the wireless suite's
  deauth budget.
- KNOB/BIAS both require on-path positioning during a real pairing
  event — plan the engagement window around when the target device
  actually pairs, not a cold scan.

## References

- KNOB: CVE-2019-9506 — https://knobattack.com
- BIAS: CVE-2020-10135 — https://biasattack.eu
- BlueBorne: CVE-2017-0781/0782/0785/14315 — Armis Labs research
- redfang: https://github.com/csuss/redfang
- bluediving: classic BT pentest framework (btscanner, L2CAP fuzzing, carwhisperer)

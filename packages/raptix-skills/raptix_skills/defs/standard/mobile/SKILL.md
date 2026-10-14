---
name: mobile-overview
description: >
  Use when the engagement target is an Android (APK / AAB) or iOS (IPA)
  application. Covers static analysis (jadx, apktool, class-dump),
  dynamic instrumentation via Frida and Objection, SSL-pinning bypass,
  root/jailbreak detection bypass, deep-link / URL-scheme abuse,
  exported-component attacks, IPC redirection, WebView vulnerabilities,
  and biometric / Face ID / Touch ID bypass.
metadata:
  subdomain: mobile
  when_to_use: "mobile android ios apk aab ipa jadx apktool frida objection ssl pinning bypass root jailbreak detection deep link url scheme exported component ipc webview biometric face id touch id"
  subdomain: mobile
  tags: mobile, android, ios, frida, objection, ssl-pinning, jadx, apktool
  mitre_attack: T1635, T1623, T1517, T1521, T1517.001
---

# Mobile Operator Skill Catalog

Mobile is 40% of modern bug-bounty programs and is conspicuously absent
from Strix and XBOW commercial. This catalog covers both platforms with
shared Frida tooling for runtime work.

## Playbooks — Android

> **Inline technique reference — not separately loadable skills.** The entries below
> are summarized here for direct use; there is no separate `SKILL.md` to open for
> each. Do NOT call the skill loader on them — apply the technique with your tools
> using this summary and the Workflow in this file.
>
> **Exception — full-depth sibling skills exist for this platform.**
> `mobile/android/SKILL.md` has command-level coverage of every row in
> this table (pull/decompile, manifest review, insecure storage, intent
> fuzzing, WebView flaws, Frida SSL-pin bypass, root-detect bypass) plus
> keystore extraction and backup-restore attacks this table doesn't even
> list. `mobile/android/il2cpp/SKILL.md` goes deeper still for Unity
> IL2CPP games specifically (`libil2cpp.so` / `global-metadata.dat`
> symbol recovery, IAP/license/anti-cheat bypass). Load one of those
> when this summary isn't enough — don't stop at the one-line entries
> below.

| Technique | Use for |
|---|---|
| **apk-triage** | apktool decode + jadx -d for source recovery |
| **manifest-analysis** | exported components, permissions, deeplinks |
| **insecure-storage** | SharedPreferences / SQLite / external storage scans |
| **intent-redirection** | Intent forwarding / pendingIntent abuse |
| **webview-flaws** | JavaScriptInterface, file:// access, mixed content |
| **frida-ssl-pin-bypass** | OkHttp / TrustKit / Cordova pin-bypass scripts |
| **root-detect-bypass** | Common root-detection libraries and their bypasses |

## Playbooks — iOS

> **Partial sibling coverage.** `mobile/ios/dynamic/SKILL.md` has
> command-level coverage of **frida-trust-killer**,
> **jailbreak-detect-bypass**, and **keychain-acl** below (plus
> biometric/LAContext bypass, not listed in this table at all) — load it
> for those three. **ipa-triage** (static, no jailbreak) is a different
> subdomain's skill (`reverser/ios-static/SKILL.md`) and is not
> necessarily visible to this role — treat it as inline-only here unless
> confirmed otherwise. **url-scheme-abuse** and **xpc-services** have no
> deeper sibling skill found in this corpus; they remain inline-only.

| Technique | Use for |
|---|---|
| **ipa-triage** | class-dump-z + Hopper; Mach-O headers; entitlements |
| **keychain-acl** | Keychain ACL misconfigurations; `kSecAccessControl` flags |
| **url-scheme-abuse** | Universal links + URL scheme handler attacks |
| **xpc-services** | XPC interface enumeration; unauthenticated XPC services |
| **frida-trust-killer** | SSL Kill Switch + Frida pin-bypass for iOS apps |
| **jailbreak-detect-bypass** | DTAppJailbreakDetectorSwift, Liberty Lite, common patterns |

## Cross-platform

> **Flutter/Dart apps are out-of-scope for both tables above.** Neither
> the Android nor iOS table covers a Flutter app (`libapp.so` /
> `Flutter.framework`, Dart AOT) — jadx/apktool/class-dump show only an
> empty shell for these. `mobile/flutter/SKILL.md` is the full-depth
> sibling skill for that case (reFlutter BoringSSL-pinning bypass,
> `libapp.so` static analysis, Dart snapshot dump).

| Technique | Use for |
|---|---|
| **frida-bridge** | frida-server install on emulator / jailbroken device; basic scripts |
| **objection-walkthrough** | Objection cheatsheet (env, memory, sqlite, classes) |
| **firebase-misconfig** | Firebase /Firestore RLS / Storage / Auth bypasses |
| **mobile-api-testing** | Burp / Caido proxy → mobile API endpoint enumeration |

## Workflow

1. **Triage**: jadx for Android, class-dump for iOS. Search strings for
   API endpoints, Firebase config, AWS keys.
2. **Static**: AndroidManifest.xml exported components; iOS Info.plist
   URL schemes + entitlements.
3. **Dynamic setup**: Frida server on a rooted emulator (Android) or
   jailbroken physical device (iOS); Objection for quick inspection.
4. **SSL pin bypass**: Frida script; verify HTTPS now visible in Burp.
5. **API enumeration**: re-route the app through the proxy; spider
   reachable endpoints; export to Burp project for later web-recon-style
   testing.
6. **Insecure storage**: pull `/data/data/<pkg>/` (Android) or app
   container (iOS); grep for credentials, tokens, PII.
7. **Component-level attacks**: send crafted Intents (`adb shell am
   start ...`) or URL-scheme payloads (`xcrun simctl openurl ...`).

## Tools sandbox

- adb + emulator / physical device.
- jadx, apktool, dex2jar, jd-gui.
- class-dump, Hopper Disassembler, IDA Free (host-side).
- Frida-server (per device), frida (host), objection.
- mitmproxy / Burp Suite Community / Caido (PR #304 lands the LangChain
  Caido tool bundle).
- MobSF (`mobsf` Docker image) for automated triage when speed matters.

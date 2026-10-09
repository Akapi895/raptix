# -*- coding: utf-8 -*-
import json, os

ROOT = r"D:\.VTNet\redteam\raptix"
UA = os.path.join(ROOT, ".ua")
S = "packages/raptix/raptix/skills/defs/standard/"

with open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8") as f:
    BJSON = json.load(f)

BATCHES = {b["batchIndex"]: b for b in BJSON["batches"]}

# path -> (summary, tags, complexity)
D = {}

# ---------------- BATCH 136 ----------------
D136 = {
 S+"exploit/web/oauth/SKILL.md": ("Skill tấn công OAuth 2.0/OIDC: bypass redirect_uri, CSRF qua tham số state, rò rỉ authorization code qua Referer, nhầm lẫn response_type, downgrade PKCE, mở rộng scope và chuỗi account takeover; workflow map flow rồi liệt kê attack surface.", ["oauth","oidc","authentication","web"], "moderate"),
 S+"exploit/web/open-redirect/SKILL.md": ("Skill open redirect + tabnabbing: bảng bypass URL filter, mở rộng chuỗi OAuth, phishing không cần hạ tầng riêng, chain sang SSRF; liệt kê tham số redirect phổ biến và mẫu PoC.", ["open-redirect","tabnabbing","phishing","web"], "simple"),
 S+"exploit/web/php-type-juggling/SKILL.md": ("Skill PHP type juggling và magic hash: khai thác so sánh lỏng (==) bằng hash collision tiền tố 0e và giá trị NULL để bypass xác thực; kèm cheat sheet so sánh lỏng và mapping ATT&CK.", ["php","type-juggling","magic-hash","auth-bypass"], "moderate"),
 S+"exploit/web/proxy-misconfig/SKILL.md": ("Skill lỗi cấu hình reverse proxy: nginx alias traversal, SSRF qua Apache mod_rewrite, lộ Spring Boot Actuator, Tomcat Manager, IIS short-name 8.3 và merge_slashes; mỗi mục có bước khai thác cụ thể.", ["reverse-proxy","nginx","apache","misconfig"], "moderate"),
 S+"exploit/web/race-condition/SKILL.md": ("Skill race condition/TOCTOU: tấn công request song song vào web check-then-act; race một endpoint (double-spend, lạm dụng coupon, tràn số dư) và multi-endpoint state-leak khi write session lộ đặc quyền sang endpoint khác, kèm tín hiệu nhận diện.", ["race-condition","toctou","concurrency","web"], "moderate"),
 S+"exploit/web/saml/SKILL.md": ("Skill tấn công SAML 2.0: 8 biến thể XML Signature Wrapping (XSW), comment injection, signature stripping, giả mạo assertion và lạm dụng IdP metadata; bắt đầu bằng bắt flow SAMLResponse.", ["saml","xsw","sso","authentication"], "moderate"),
 S+"exploit/web/smuggling/SKILL.md": ("Skill HTTP Request Smuggling (HRS) lớn nhất batch (656 dòng): desync front-end/back-end qua CL.TE, TE.CL, TE.TE, CL.0, HTTP/2 downgrade (h2.cl, h2.te), pipelining và connection-state pinning; có confirm-desync gate bắt buộc, catalog obfuscation header và harness Python raw-socket tối giản.", ["http-smuggling","desync","http2","raw-socket"], "complex"),
 S+"exploit/web/sqli/SKILL.md": ("Skill SQL Injection: Union-based, Error-based, Blind (Boolean/Time-based) và stacked queries; tự động hóa sqlmap với tamper script bypass WAF, fast-path blind SQLi bắt buộc và quy tắc quyết định manual-vs-tool.", ["sqli","sqlmap","injection","database"], "moderate"),
 S+"exploit/web/ssrf/SKILL.md": ("Skill SSRF: khai thác URL fetch phía server để truy cập dịch vụ nội bộ, cloud metadata AWS/GCP/Azure, internal API và port scanning; bypass bằng kỹ thuật IP, DNS rebinding, Gopher protocol smuggling và redirect.", ["ssrf","cloud-metadata","gopher","bypass"], "moderate"),
 S+"exploit/web/ssti/SKILL.md": ("Skill SSTI — RCE qua template engine: Jinja2 (Flask/Django), Twig, Freemarker, ERB, Razor; fingerprint engine, xây chuỗi MRO, bypass filter; có fast-path default-credentials khi co-tag.", ["ssti","jinja2","rce","template-injection"], "moderate"),
 S+"exploit/web/verb-tampering/SKILL.md": ("Skill HTTP verb/method tampering: bypass auth bằng HEAD/OPTIONS/method tùy ý, header X-HTTP-Method-Override, lộ TRACE/PUT/DELETE và lỗi routing framework; kèm cách kiểm tra endpoint trả lời non-standard verb.", ["verb-tampering","auth-bypass","http-methods"], "moderate"),
 S+"exploit/web/waf-bypass/SKILL.md": ("Skill WAF evasion: fingerprint WAF trước, obfuscation payload, evasion ở mức HTTP, tìm origin IP, né rate/anomaly; ghi chú riêng cho Cloudflare/Akamai/AWS WAF/ModSecurity.", ["waf-bypass","evasion","cloudflare","obfuscation"], "moderate"),
 S+"exploit/web/web-cache-poisoning/SKILL.md": ("Skill cache poisoning qua unkeyed input: X-Forwarded-Host/Scheme/Port, X-Original-URL, fat-GET, parameter cloaking, DoS header oversized; chain sang stored-XSS/open redirect qua cache dùng chung.", ["cache-poisoning","web-cache","headers"], "simple"),
 S+"exploit/web/xpath-xslt/SKILL.md": ("Skill XPath + XSLT injection: thao túng truy vấn trên XML datastore, RCE phía server qua XSLT document()/EXSLT extensions; có mục detection, PoC và severity.", ["xpath","xslt","injection","xml"], "simple"),
 S+"exploit/web/xs-leaks/SKILL.md": ("Skill XS-Leaks: rò rỉ thông tin cross-site qua timing, frame counting, navigation, error oracle — side-channel đánh vào trạng thái authenticated same-origin; tham chiếu chuẩn xsleaks.dev.", ["xs-leaks","side-channel","timing","browser"], "simple"),
 S+"exploit/web/xss/SKILL.md": ("Skill XSS: reflected, stored, DOM-based; bypass filter, né CSP, exfiltrate cookie qua bot, scrape trang admin, trích flag từ headless browser; xác định win-condition trước khi exploit theo pattern CTF.", ["xss","csp-bypass","cookie-theft","client-side"], "moderate"),
 S+"exploit/web/xxe/SKILL.md": ("Skill XXE: đọc file local qua XML parser, khai thác SOAP/WSDL, exfil out-of-band blind, XXE qua upload SVG/DOCX/XLSX.", ["xxe","xml","soap","oob"], "moderate"),
 S+"ics/SKILL.md": ("Skill tổng quan lane ICS/OT: target Modbus, BACnet, S7Comm/S7Comm Plus, DNP3, OPC-UA và stack PLC/HMI/SCADA; bắt buộc RoE flag industrial_safety_critical=true, mọi thao tác write phải qua xác nhận operator bất kể HITL middleware; playbooks, workflow, detection gap.", ["ics","ot","scada","safety"], "simple"),
 S+"iot/SKILL.md": ("Skill tổng quan lane IoT/embedded: firmware acquisition, binwalk extract, mount filesystem, săn default-credential, tấn công bootloader, sideband không dây BLE/Zigbee/Z-Wave/LoRaWAN/sub-GHz; liệt kê playbooks, hardware bench tools và luật an toàn.", ["iot","embedded","firmware","overview"], "simple"),
 S+"iot/binwalk-extract/SKILL.md": ("Skill trích xuất firmware bằng binwalk/firmware-mod-kit: carve archive đệ quy, mount squashfs/jffs2/ubifs, phân tích entropy phát hiện vùng packed/encrypted, xử lý container lồng nhau — entry point cho phân tích filesystem tĩnh sau khi có ảnh binary thô.", ["binwalk","firmware","extraction","squashfs"], "moderate"),
 S+"iot/ble-gatt/SKILL.md": ("Skill BLE GATT: enumerate service/characteristic, khai thác read/write không xác thực, hạ cấp pairing về Just Works, sniff OTA bằng Sniffle/Ubertooth; chú ý kênh firmware update, debug service ẩn và thiếu auth trên characteristic nhạy cảm.", ["ble","gatt","bluetooth","sniffing"], "moderate"),
 S+"iot/bootloader-uboot/SKILL.md": ("Skill tấn công U-Boot: interrupt console phá đếm autoboot, đọc/ghi biến môi trường, override bootargs thành init=/bin/sh, bypass secure-boot và fault injection cơ bản (voltage/clock glitching) cho target MIPS/ARM/AArch64.", ["uboot","bootloader","secure-boot","glitching"], "complex"),
 S+"iot/dev-mem/SKILL.md": ("Skill truy cập bộ nhớ runtime embedded Linux qua /dev/mem, /dev/kmem và MTD: đọc/ghi physical memory, resolve kernel symbol qua /proc/kallsyms, patch firmware live bằng mtd_debug/flashcp, né CONFIG_STRICT_DEVMEM và kernel.perf_event_paranoid.", ["dev-mem","mtd","kernel","embedded-linux"], "complex"),
 S+"iot/firmware-acquisition/SKILL.md": ("Skill thu thập firmware có hệ thống: portal vendor, chặn OTA, dump SPI flash bằng flashrom/CH341A, chip-off eMMC, dump console UART/JTAG; chuỗi acquisition đầy đủ từ zero hardware access tới binary thô sẵn sàng phân tích tĩnh.", ["firmware","acquisition","spi","uart"], "complex"),
 S+"iot/hardcoded-creds/SKILL.md": ("Skill săn hardcoded credentials trong firmware đã trích xuất: parse /etc/shadow và passwd, config busybox httpd, stanza telnet/dropbear, trích MQTT/cloud API key, đối chiếu database default-credential phổ biến.", ["hardcoded-credentials","firmware","default-creds","secrets"], "moderate"),
}

# ---------------- BATCH 137 ----------------
D137 = {
 S+"iot/lorawan-otaa/SKILL.md": ("Skill LoRaWAN OTAA: phân tích join procedure (trích DevEUI/AppEUI/AppKey), replay frame-counter trên thiết bị ABP, inject downlink qua rogue gateway, bit-flipping FRMPayload không bảo vệ, enumeration bằng ChirpStack và LoRaWAN Auditing Framework; kèm bảng tần số tham chiếu.", ["lorawan","otaa","rf","replay"], "moderate"),
 S+"iot/ros2-dds-attack/SKILL.md": ("Skill tấn công ROS2/DDS: enumerate topic không xác thực, inject message, chặn telemetry nhắm nền tảng robot và autonomous system; nền tảng về DDS discovery kèm phase discovery.", ["ros2","dds","robotics","injection"], "moderate"),
 S+"iot/sub-ghz/SKILL.md": ("Skill RF Sub-GHz 433/868/915 MHz: capture/replay fixed-code bằng HackRF/Flipper Zero/RTL-SDR, phân tích rolling-code với rfcat, visualize bằng inspectrum/Universal Radio Hacker, nhận diện encoding/modulation cho cửa gara, chìa khóa xe, cảm biến báo động.", ["sub-ghz","rf","hackrf","replay"], "moderate"),
 S+"iot/z-wave/SKILL.md": ("Skill Z-Wave: khai thác lỗi derive network-key S0, phân tích S2 ECDH/DSK, replay node không xác thực, capture bằng RTL-SDR + gr-zwave, fuzz/replay với EZ-Wave và Z-Force trên băng 868.42 MHz (EU) / 908.42 MHz (US).", ["z-wave","s0","rf","rtl-sdr"], "moderate"),
 S+"iot/zigbee-touchlink/SKILL.md": ("Skill Zigbee Touchlink: lạm dụng commissioning ZLL bằng transport key well-known, inject lệnh ZCL (toggle/move/step), trích network key, factory reset qua touchlink; toolchain KillerBee, zbstumbler, zbreplay và Sonoff Zigbee dongle + Wireshark live capture.", ["zigbee","touchlink","zll","killerbee"], "moderate"),
 S+"mobile/SKILL.md": ("Skill tổng quan lane mobile: target Android (APK/AAB) và iOS (IPA); phân tích tĩnh (jadx, apktool, class-dump), instrument động Frida/Objection, bypass SSL pinning, né root/jailbreak detection, lạm dụng deep-link/URL-scheme, exported component, IPC redirect, lỗ hổng WebView; liệt kê playbooks Android/iOS và sandbox tools.", ["mobile","android","ios","overview"], "simple"),
 S+"mobile/android/SKILL.md": ("Skill pentest APK Android: static decompile + phân tích bằng apktool/jadx, instrument động Frida + Objection, bypass SSL pinning, né root detection, fuzz intent, trích keystore.", ["android","apk","frida","ssl-pinning"], "moderate"),
 S+"mobile/android/il2cpp/SKILL.md": ("Skill reversing Unity IL2CPP: khôi phục metadata bằng Il2CppDumper, giải mã global-metadata.dat, phục hồi symbol IDA/Ghidra qua script sinh sẵn, hook method bằng Frida, bypass IAP/license, dùng zygisk-il2cpp-dumper cho metadata obfuscated.", ["il2cpp","unity","game","frida"], "complex"),
 S+"mobile/flutter/SKILL.md": ("Skill reversing Flutter + bypass SSL pinning: patch Dart-AOT bằng reFlutter, bypass BoringSSL, phân tích tĩnh libapp.so trong Ghidra/radare2, dump Dart snapshot, ghi chú riêng cho iOS Flutter.framework.", ["flutter","ssl-pinning","dart","reversing"], "complex"),
 S+"mobile/ios/dynamic/SKILL.md": ("Skill instrument động iOS trên máy jailbroken: setup Frida/Objection, bypass pinning bằng SSL Kill Switch, né jailbreak detection, dump keychain, bypass biometric/LAContext, hook method ObjC runtime.", ["ios","frida","objection","keychain"], "complex"),
 S+"osint/SKILL.md": ("Skill tổng quan lane OSINT: chạy passive recon thuần — không gửi gói tin tới hạ tầng authoritative của target; tách khỏi Recon agent để bug bounty/pre-engagement chạy với network policy outbound-only; Maltego, Shodan, Censys, Hunter.io, breach data, GitHub code search, Wayback; playbooks + network policy + lý do tách khỏi Recon.", ["osint","passive","intelligence","overview"], "simple"),
 S+"phisher/SKILL.md": ("Skill catalog phishing/social-engineering cho Phisher agent — CHỈ dùng khi RoE cho phép: thiết kế pretext, campaign GoPhish, proxy evilginx2 bypass MFA, harvest O365 credential/token, lookalike domain và handshake deconfliction blue-team bắt buộc; kèm infrastructure pattern + failsafe.", ["phishing","social-engineering","overview","roe"], "simple"),
 S+"phisher/evilginx2-proxy/SKILL.md": ("Skill triển khai evilginx2 phishlet: reverse-proxy trang login thật để capture session cookie post-authentication, vượt MFA qua đánh cắp session token; deploy, viết phishlet khi chưa có cho target, capture + replay, evidence, OPSEC.", ["evilginx2","phishlet","mfa-bypass","session-hijack"], "simple"),
 S+"phisher/gophish-campaign/SKILL.md": ("Skill chạy campaign GoPhish qua REST API: sending profile, groups, email template, landing page, launch và polling event tracking; flow đầy đủ kèm evidence và failsafe OPSEC.", ["gophish","phishing","campaign","rest-api"], "simple"),
 S+"phisher/html-smuggling-lure/SKILL.md": ("Skill HTML smuggling cho initial access: nhúng binary base64 trong attachment HTML tự tái tạo và auto-download client-side qua JavaScript Blob, qua mặt email gateway/proxy kiểm tra file-type; template cơ bản + quick reference + mapping ATT&CK.", ["html-smuggling","lure","initial-access","blob"], "complex"),
 S+"phisher/lookalike-domain/SKILL.md": ("Skill đăng ký/provision lookalike/Punycode domain: chọn tên, cấu hình DNS + TLS để lure GoPhish/evilginx2 resolve và qua được kiểm tra mail + browser hiện đại; verify trước khi gửi, kèm evidence.", ["lookalike-domain","punycode","dns","tls"], "simple"),
 S+"phisher/lure-deconfliction/SKILL.md": ("Skill deconfliction bắt buộc: handshake out-of-band với đầu mối blue-team TRƯỚC khi campaign gửi bất kỳ lure nào — bỏ qua là vi phạm RoE nghiêm trọng vì engagement không có legal coverage cho phishing nhân viên thật; liệt kê input cần, payload handshake và kênh gửi.", ["deconfliction","roe","blue-team","mandatory"], "moderate"),
 S+"phisher/mfa-fatigue-social/SKILL.md": ("Skill MFA fatigue (push-bombing) kết hợp giả danh help-desk: spam MFA push cho target rồi vishing giả IT support để dụ duyệt; automation push-bombing + quick reference + mapping ATT&CK.", ["mfa-fatigue","push-bombing","vishing","social-engineering"], "complex"),
 S+"phisher/o365-credential-harvest/SKILL.md": ("Skill harvest/replay O365/Entra ID qua OAuth device-code flow và token thu được (pattern TokenTactics), bỏ qua prompt password + MFA; validate token, evidence, RoE/OPSEC.", ["o365","device-code","token-replay","entra-id"], "simple"),
 S+"phisher/pdf-credential-harvest/SKILL.md": ("Skill PDF weaponized: attachment redirect nạn nhân tới portal login giả (SharePoint, M365, Google Workspace) — không exploit, không macro, chỉ tài liệu thuyết phục kèm link trang capture credential; quick reference + mapping ATT&CK.", ["pdf","credential-harvest","phishing","lure"], "complex"),
 S+"phisher/pretext-engineering/SKILL.md": ("Skill thiết kế pretext + shortlist target từ OSINT trước khi dựng campaign: sender persona, kịch bản, timing, target set tối thiểu; liệt kê lure pattern bị cấm và output chuẩn.", ["pretext","social-engineering","osint","target-selection"], "simple"),
 S+"phisher/quishing/SKILL.md": ("Skill QR-code phishing (quishing): sinh QR lure chứa URL harvest credential, nhúng vào PDF/email body, qua mặt URL scanner của gateway vì không parse được payload ảnh QR; quick reference + mapping ATT&CK.", ["quishing","qr-code","phishing","bypass"], "complex"),
 S+"post-exploit/c2-alternative-channels/SKILL.md": ("Skill C2 kênh phi truyền thống (488 dòng): bot Discord/Telegram, DNS-over-HTTPS, C2 blockchain, C2 qua email, dead drop cloud function cho command and control bí mật; quick reference + mapping ATT&CK.", ["c2","discord","telegram","doh"], "complex"),
 S+"post-exploit/c2-cobalt-strike/SKILL.md": ("Skill vận hành Cobalt Strike (429 dòng): deploy Beacon, viết Malleable C2 profile, setup listener, cấu hình beacon OPSEC-safe, process injection, dùng Arsenal kit; teamserver setup + listener configuration.", ["cobalt-strike","beacon","malleable-c2","opsec"], "complex"),
 S+"post-exploit/c2-domain-fronting/SKILL.md": ("Skill domain fronting + lạm dụng CDN che giấu C2 (488 dòng): CloudFront, Azure CDN, Fastly, kỹ thuật TLS SNI vs Host header, CDN redirector, tích hợp Cobalt Strike và Sliver.", ["domain-fronting","cdn","c2","cloudfront"], "complex"),
}

# ---------------- BATCH 138 ----------------
D138 = {
 S+"post-exploit/c2-sliver/SKILL.md": ("Skill vận hành Sliver C2 (410 dòng): kết nối server, setup listener, sinh implant, extension BOF/Armory, thao tác post-implant, HTTP C2 profile; có phần Raptix Setup riêng cho hạ tầng lab.", ["sliver","c2","implant","bof"], "complex"),
 S+"post-exploit/c2-sliver/references/sliver-quickstart.md": ("Tài liệu tham khảo Sliver quickstart: kiến trúc C2 trong Raptix, setup server, cấu hình listener, sinh implant — hướng dẫn nhanh rút gọn đi kèm skill c2-sliver.", ["sliver","quickstart","reference"], "simple"),
 S+"post-exploit/c2/SKILL.md": ("Skill C2 orchestration framework-agnostic: các loại listener, chế độ implant, kiến trúc redirector, malleable profile, chiến lược jitter, hướng dẫn OPSEC; kiến trúc C2 của Raptix + mapping ATT&CK.", ["c2","orchestration","redirector","opsec"], "moderate"),
 S+"post-exploit/c2/havoc/SKILL.md": ("Skill Havoc C2: thay thế Sliver/CS hiện đại — Demon agent với indirect syscall, sleep obfuscation (Ekko/Zilean/FOLIAGE), tích hợp Donut PIC loader, comms HTTP theo profile, web client MaterialUI; dùng khi cần OPSEC hiện đại mà không tốn chi phí Cobalt Strike.", ["havoc","c2","demon","syscall"], "moderate"),
 S+"post-exploit/c2/mythic/SKILL.md": ("Skill Mythic C2: multi-agent (Apfell, Apollo, Athena, Poseidon, Medusa), web UI cổng 7443, backend RabbitMQ + PostgreSQL, tasking JSON-RPC, build agent qua mythic-cli, thiết kế profile (HTTP/SMB/named pipe/P2P), opsec defaults; so sánh với Sliver.", ["mythic","c2","apollo","rabbitmq"], "moderate"),
 S+"post-exploit/credential-access/SKILL.md": ("Skill trích xuất credential (377 dòng): dump LSASS, trích hive SAM/SECURITY, giải mã DPAPI, NTLM relay, poisoning bằng Responder, password spraying, crack hash.", ["credential-access","lsass","dpapi","ntlm"], "complex"),
 S+"post-exploit/credential-access/references/lsass-techniques.md": ("Tham khảo kỹ thuật LSASS: bảng so sánh method, các kỹ thuật xếp theo mức stealth, trích hive SAM/SECURITY — tài liệu nền cho skill credential-access.", ["lsass","reference","stealth"], "simple"),
 S+"post-exploit/lateral-movement/SKILL.md": ("Skill lateral movement (460 dòng): Pass-the-Hash, Pass-the-Ticket, thực thi WMI/WinRM/PsExec/RDP, thao tác SMB, tunnel mạng bằng Ligolo-ng và Chisel.", ["lateral-movement","pass-the-hash","wmi","tunneling"], "complex"),
 S+"post-exploit/linux-privesc-enum/SKILL.md": ("Skill phương pháp enumerate privesc Linux có hệ thống (410 dòng): các phase theo thứ tự — sudo, SUID/SGID, capabilities, cron, writable path, NFS, kernel CVE, tra GTFOBins; dựa trên nghiên cứu privesc tự động LLM (hackingBuddyGPT/ipa-lab).", ["linux","privesc","enumeration","gtfobins"], "complex"),
 S+"post-exploit/macos/SKILL.md": ("Skill post-exploitation macOS: persistence launchd, bypass TCC, truy cập Keychain, dylib hijacking, né Gatekeeper/quarantine, discovery trên host Apple; mỗi mục gắn tactic ATT&CK, có ghi chú blue-cell về detection.", ["macos","launchd","tcc","keychain"], "simple"),
 S+"post-exploit/network-replay/SKILL.md": ("Skill replay mạng dựa trên PCAP: capture chuỗi xác thực, session token, protocol frame rồi replay/inject để đạt truy cập trái phép hoặc session hijack; inventory tool + phase capture và extract replayable material.", ["network-replay","pcap","session-hijack","traffic"], "moderate"),
 S+"post-exploit/privilege-escalation/SKILL.md": ("Skill privesc host (499 dòng): Windows token impersonation (họ Potato), bypass UAC, lạm dụng service, DLL hijacking; Linux SUID/sudo/kernel exploit; enumeration tự động.", ["privilege-escalation","potato","uac-bypass","dll-hijacking"], "complex"),
 S+"post-exploit/reporting/SKILL.md": ("Skill báo cáo post-exploitation (549 dòng): template finding cho credential access/privesc/lateral movement, phân tích detection gap, tài liệu hóa attack path, chấm điểm CVSS v4.0.", ["reporting","cvss","findings","detection-gap"], "complex"),
 S+"recon/active-recon/SKILL.md": ("Skill active recon (399 dòng): port scan, service detection, vuln scan, banner grabbing, fuzz web directory, phân tích SSL/TLS; nguyên tắc OPSEC cho quét chủ động và các pattern Nmap copy-paste.", ["active-recon","port-scanning","nmap","opsec"], "complex"),
 S+"recon/cloud-recon/SKILL.md": ("Skill enumeration cloud: S3/GCS/Azure blob bucket, cloud metadata endpoint, IAM misconfiguration, phát hiện CDN origin; phát hiện provider trước khi enumerate sâu.", ["cloud-recon","s3","azure","gcp"], "moderate"),
 S+"recon/cloud-recon/references/cloud-ip-ranges.md": ("Tham khảo IP ranges cloud: endpoint live tải IP range AWS/GCP/Azure, script check IP nhanh, mapping CNAME → provider.", ["cloud","ip-ranges","reference"], "simple"),
 S+"recon/cloud-recon/references/cloud-naming-patterns.md": ("Tham khảo pattern đặt tên bucket S3/GCS/Azure Blob để dò bucket theo cấu trúc tên tổ chức.", ["bucket-naming","cloud","reference"], "simple"),
 S+"recon/iot-security/SKILL.md": ("Skill recon IoT (363 dòng): trích firmware, phân tích embedded, nhận diện protocol, check default credential, vuln scan, device fingerprinting.", ["iot","recon","firmware","fingerprinting"], "complex"),
 S+"recon/mobile-security/SKILL.md": ("Skill recon mobile (233 dòng): phân tích APK/IPA, enumerate permission, kiểm tra certificate/signature, phát hiện hardcoded secret, nhận diện insecure storage, phân tích network security.", ["mobile","apk","ipa","secrets"], "moderate"),
 S+"recon/open-web/SKILL.md": ("Skill đọc trang public + tìm kiếm OSINT bền vững: web_search (provider allowlist) và web_fetch (grid curl_cffi TLS-impersonation + fallback headless browser qua WAF/403/anti-bot); quy tắc R2 (HTTP 200 chưa chắc success), R6 (give-up không phải exhaustion) và biên RoE/OSINT.", ["osint","web-fetch","anti-bot","roe"], "simple"),
 S+"recon/osint/SKILL.md": ("Skill OSINT (235 dòng): harvest email, profile social media, check breach data, enumerate employee, scan GitHub secret, mapping tổ chức.", ["osint","email-harvest","breach-data","github"], "moderate"),
 S+"recon/passive-recon/SKILL.md": ("Skill passive recon không chạm target (311 dòng): DNS, WHOIS, enumerate subdomain, Certificate Transparency, fingerprint technology, map ASN; kèm bộ lệnh copy-paste nhanh.", ["passive-recon","dns","whois","subdomain"], "moderate"),
 S+"recon/passive-recon/references/dns-techniques.md": ("Tham khảo kỹ thuật DNS: loại record phục vụ recon, so sánh tool enumerate subdomain, cấu hình Subfinder, Certificate Transparency chi tiết, passive DNS database, intelligence ASN/BGP.", ["dns","reference","subdomain","ct-logs"], "simple"),
 S+"recon/passive-recon/scripts/parse_subdomains.py": ("Script Python parse subdomain cho passive-recon: đọc file text đầu vào (output HTTP, txt), trích subdomain bằng regex, gộp unique, sort rồi ghi output; CLI argparse nhận input/output, báo lỗi nếu file không tồn tại.", ["python","parser","subdomain","cli"], "moderate"),
 S+"recon/reporting/SKILL.md": ("Skill báo cáo recon (495 dòng): cấu trúc report, template finding document, chấm điểm CVSS v4.0 (primary), mapping MITRE ATT&CK, ưu tiên hóa finding, output Markdown, tracking detection gap, checklist handoff.", ["reporting","cvss","recon","handoff"], "complex"),
}

# ---------------- BATCH 139 ----------------
D139 = {
 S+"recon/web-recon/SKILL.md": ("Skill hub enumeration web app: fuzz directory/file, phát hiện vhost, enumerate API, scan CMS, detect WAF, map auth surface, audit cookie; fast-path theo tag + pattern dedup HTTP request + danh sách output file.", ["web-recon","hub","fuzzing","waf"], "simple"),
 S+"recon/web-recon/api-enumeration/SKILL.md": ("Skill enumerate REST API: phát hiện GraphQL, fuzz parameter; endpoint enumeration và parameter discovery.", ["api","graphql","enumeration"], "simple"),
 S+"recon/web-recon/auth-mapping/SKILL.md": ("Skill map auth surface: tìm login endpoint, nhận diện cơ chế JWT/OAuth/SAML/SSO/API-key, output handoff cho agent exploit.", ["auth-mapping","jwt","oauth","sso"], "simple"),
 S+"recon/web-recon/cms-scanning/SKILL.md": ("Skill scan CMS: phát hiện phiên bản WordPress (wpscan), Joomla, Drupal.", ["cms","wordpress","wpscan","joomla"], "simple"),
 S+"recon/web-recon/cookie-audit/SKILL.md": ("Skill audit cookie: bisect cookie bắt buộc theo sink, dựng timeline session-write phục vụ challenge race-condition.", ["cookie","session","race-condition"], "simple"),
 S+"recon/web-recon/discovery/SKILL.md": ("Skill web discovery: fuzz directory/file, vhost discovery, trích endpoint JavaScript; có probe alias off-by-one cho Nginx/Apache.", ["discovery","fuzzing","vhost","javascript"], "simple"),
 S+"recon/web-recon/subdomain-takeover/SKILL.md": ("Skill subdomain takeover qua dangling DNS/CNAME: fingerprint GitHub Pages, Heroku, Azure, Fastly, Shopify, Netlify, Surge, Tumblr, Beanstalk, Zendesk; quy trình enumerate asset → CNAME → body fingerprint.", ["subdomain-takeover","dns","cname"], "moderate"),
 S+"recon/web-recon/waf-detection/SKILL.md": ("Skill fingerprint WAF: nhận diện Cloudflare, AWS WAF, Akamai, Imperva qua header/behavior; kèm tín hiệu multi-proxy/smuggling.", ["waf","fingerprinting","cloudflare"], "simple"),
 S+"recon/wireless-security/SKILL.md": ("Skill recon bảo mật không dây (380 dòng): phân tích WiFi, đánh giá Bluetooth, RFID/NFC, capture tín hiệu, phân tích protocol, kiểm thử mã hóa, phát hiện rogue device.", ["wireless","wifi","bluetooth","rfid"], "complex"),
 S+"reverser/SKILL.md": ("Skill root pointer lane binary reversing: điều hướng tới triage, fallback Radare2, trích string, unpack packer, virtualized protector, rủi ro symbol, ROP, deep analysis Ghidra, trích firmware; playbooks + workflow.", ["reversing","overview","triage"], "simple"),
 S+"reverser/android-malware/SKILL.md": ("Skill phân tích malware Android (333 dòng): review permission manifest, disassembly smali, decompile Java bằng jadx, instrument Frida, chặn network traffic, phân tích native library, scan tự động MobSF.", ["android-malware","jadx","frida","mobsf"], "complex"),
 S+"reverser/anti-debug-bypass/SKILL.md": ("Skill phát hiện + vô hiệu hóa anti-debug/anti-VM: IsDebuggerPresent, ptrace, NtGlobalFlag, timing, hardware-breakpoint detection; enumerate kỹ thuật trong binary rồi áp bypass tương ứng.", ["anti-debug","bypass","ptrace"], "moderate"),
 S+"reverser/ctf-triage/SKILL.md": ("Skill triage + giải challenge CTF (350 dòng): phát hiện category, chọn tool, chuỗi solve multi-step qua pwn/rev/crypto/forensics/web/misc; Phase 0 triage luôn chạy trước, fast-path riêng cho pwn.", ["ctf","triage","pwn","methodology"], "complex"),
 S+"reverser/deep-analysis/SKILL.md": ("Skill vòng lặp RE depth-first cho một binary/cụm function (235 dòng): decompile→rename→retype→comment→đọc lại với guard chống context-rot và check on-task; dùng khi triage đã xác định vùng quan trọng — hiểu function X, nhận diện crypto primitive, định vị C2 protocol, khôi phục struct.", ["deep-analysis","decompilation","crypto","c2-protocol"], "complex"),
 S+"reverser/dotnet-malware/SKILL.md": ("Skill phân tích malware .NET (304 dòng): decompile dnSpy/ILSpy, de-obfuscate (ConfuserEx, .NET Reactor, Babel, Crypto Obfuscator), phân tích hành vi managed assembly, trích PowerShell cradle, giải mã config các họ .NET RAT phổ biến.", ["dotnet","malware","dnspy","deobfuscation"], "complex"),
 S+"reverser/fileless-malware/SKILL.md": ("Skill phát hiện malware in-memory/fileless (319 dòng): phân tích AMSI bypass, reflective DLL injection, CLR-hosted payload, process hollowing, chuỗi PowerShell cradle, persistence WMI/COM, payload resident registry; memory forensics + trích payload.", ["fileless","amsi","process-hollowing","powershell"], "complex"),
 S+"reverser/firmware/SKILL.md": ("Skill pipeline trích xuất firmware router/IoT: unpack filesystem lồng nhau, định vị web server binary, tìm backdoor credential, audit auth bypass, đối chiếu CVE; 7 bước từ extract tới record.", ["firmware","router","backdoor","web-server"], "simple"),
 S+"reverser/fuzzing/SKILL.md": ("Skill fuzzing coverage-guided cho binary/library (272 dòng): scoping target, chọn fuzzer (AFL++/libFuzzer/Honggfuzz), khung harness, flag ASan+UBSan, curate corpus, triage + minimize crash (afl-tmin), rubric đánh giá exploitability; output corpus/crash vào /workspace.", ["fuzzing","afl","harness","sanitizer"], "complex"),
 S+"reverser/game-security/SKILL.md": ("Skill research bảo mật game có ủy quyền: client, protocol, replay, anti-tamper cho target local/self-hosted/cố ý dễ tổn thương; workflow + luật promotion.", ["game-security","anti-tamper","protocol"], "simple"),
 S+"reverser/ghidra/SKILL.md": ("Skill phân tích binary sâu bằng Ghidra: headless analyzeHeadless hoặc MCP bridge live với 245 tools; decompile, xrefs, function listing, batch operations, P-code emulation, enforce convention; có fallback sinh script.", ["ghidra","decompiler","mcp","headless"], "simple"),
 S+"reverser/ios-static/SKILL.md": ("Skill phân tích tĩnh IPA iOS (162 dòng): class-dump-z/class-dump-ng, Hopper/IDA/Ghidra cho Mach-O ARM64, introspection ObjC runtime, Swift demangling, kiểm tra App Transport Security, phân tích plist, parse provisioning profile; quy trình acquire + unpack IPA + quick triage.", ["ios","ipa","mach-o","class-dump"], "moderate"),
 S+"reverser/malware-triage/SKILL.md": ("Skill triage malware nhanh (142 dòng): tĩnh (PE/Mach-O/ELF, strings, imports, entropy/packed), động (sandbox INetSim, Wireshark, Process Monitor, time-shift), unpack (Scylla/PE-sieve), rồi RE đầy đủ Ghidra/IDA; mục tiêu verdict ban đầu ≤15 phút.", ["malware-triage","sandbox","unpacking","pe"], "moderate"),
 S+"reverser/packer-unpacking/SKILL.md": ("Skill nhận diện + unpack packer phổ biến: UPX, ASPack, Themida, VMProtect, MPRESS, PECompact, Enigma; detect packing qua signature và automated unpacking.", ["packer","unpacking","upx","vmprotect"], "moderate"),
 S+"reverser/ransomware-analysis/SKILL.md": ("Skill nhận diện + phân tích ransomware (343 dòng): nhận diện scheme mã hóa, kỹ thuật khôi phục key, parse ransom note, phân tích shadow copy/recovery inhibition, check decryptor công khai, trích IOC theo họ.", ["ransomware","encryption","ioc","key-recovery"], "complex"),
 S+"reverser/rootkit-analysis/SKILL.md": ("Skill phát hiện + phân tích rootkit (428 dòng): UEFI rootkit, kernel-level, bootkit, kỹ thuật DKOM, hook SSDT/IDT/IRP, hypervisor rootkit, firmware implant; dùng GMER, Volatility, chipsec, UEFITool.", ["rootkit","uefi","volatility","chipsec"], "complex"),
}

# ---------------- BATCH 140 ----------------
D140 = {
 S+"reverser/rop-chain/SKILL.md": ("Skill hunt ROP/JOP gadget + dựng exploit chain (213 dòng): bypass NX/DEP trên binary x86/x64/ARM; inventory mitigations, tìm gadget, các pattern chain phổ biến.", ["rop","gadgets","nx-bypass","exploitation"], "moderate"),
 S+"reverser/triage/SKILL.md": ("Skill triage binary fast-path: nhận diện format/arch/mitigations, harvest string high-signal và imports trong dưới một phút; version → CVE rồi handoff.", ["triage","strings","imports","fast-path"], "simple"),
 S+"reverser/virtualized-protectors/SKILL.md": ("Skill reversing VMProtect, VMP2, Themida, CodeVirtualizer dựa trên fact Radare2/Ghidra và hướng dẫn research Back Engineering Labs; vòng lặp làm việc + shape báo cáo.", ["vmprotect","themida","virtualization","radare2"], "simple"),
 S+"reverser/windows-internals/SKILL.md": ("Skill đánh giá Windows internals/driver exposure phòng thủ cho hệ thống có chủ ủy quyền và VM research dùng một lần; workflow evidence-first + luật promotion.", ["windows","driver","defense","assessment"], "simple"),
 S+"reverser/yara-hunting/SKILL.md": ("Skill viết rule YARA + hunting (170 dòng): cú pháp condition, hex pattern wildcard, for/any of them, module PE/ELF/hash/math; dựng signature theo họ malware, hunt qua VT/MalwareBazaar/Hybrid Analysis, tránh pitfall (collision, rule chậm, bẫy regex).", ["yara","hunting","signatures","malware"], "moderate"),
 S+"soundwave/abort-template/SKILL.md": ("Skill sinh abort/crisis plan: halt trigger, hành động phản ứng, safety gate nhận thức AI (ngưỡng hallucination, gate destructive-action, validate output); workflow + validation checklist + anti-pattern.", ["abort-plan","safety-gates","soundwave"], "simple"),
 S+"soundwave/cleanup-template/SKILL.md": ("Skill sinh cleanup & restoration plan: inventory artifact, lệnh gỡ persistence, baseline trước engagement, verify sau engagement; workflow + checklist + anti-pattern.", ["cleanup","restoration","soundwave"], "simple"),
 S+"soundwave/conops-template/SKILL.md": ("Skill tạo tài liệu CONOPS: tóm tắt executive, profile threat actor, attack narrative, thiết kế kill chain, kế hoạch liên lạc, deconfliction; kèm generation rules.", ["conops","kill-chain","soundwave"], "simple"),
 S+"soundwave/conops-template/references/kill-chain-templates.md": ("Tham khảo template kill chain: mô hình 5 phase, chọn phase theo loại engagement, mapping tactic MITRE ATT&CK, routing sub-agent theo phase, hướng dẫn OPSEC level theo phase.", ["kill-chain","reference","mitre","opsec"], "simple"),
 S+"soundwave/contact-template/SKILL.md": ("Skill sinh contact/communications plan: operator chính, chuỗi escalation, người nhận abort signal, endpoint SOC ngoài, blackout window; workflow + checklist + anti-pattern.", ["contact-plan","communications","soundwave"], "simple"),
 S+"soundwave/data-handling-template/SKILL.md": ("Skill sinh data handling plan: giữ evidence, mã hóa, chain-of-custody, khung compliance (GDPR/HIPAA/PCI-DSS/SOC2); workflow + checklist + anti-pattern.", ["data-handling","compliance","evidence","soundwave"], "simple"),
 S+"soundwave/opplan-converter/SKILL.md": ("Skill chuyển tài liệu engagement thành OPPLAN machine-readable cho ralph loop: phân rã objective, acceptance criteria, mapping MITRE, sắp thứ tự ưu tiên.", ["opplan","converter","ralph-loop","objectives"], "simple"),
 S+"soundwave/opplan-converter/references/objective-rules.md": ("Tham khảo 6 luật objective OPPLAN: một objective = một context window, thứ tự kill-chain phase, acceptance criteria bắt buộc, chỉ tiêu chí verify được, mapping MITRE ATT&CK, gán OPSEC level.", ["opplan","rules","acceptance-criteria","reference"], "simple"),
 S+"soundwave/opplan-converter/references/objective-templates.md": ("Tham khảo template objective OPPLAN theo phase kill chain, bắt đầu với passive recon priority 1-5 mở rộng cho các phase còn lại.", ["opplan","templates","kill-chain","reference"], "simple"),
 S+"soundwave/references/schema-quick-reference.md": ("Tham khảo nhanh schema Soundwave: các trường của RoE (Rules of Engagement), CONOPS (Concept of Operations) và DeconflictionPlan — mẫu cấu trúc chuẩn cho bộ tài liệu kế hoạch.", ["schema","roe","conops","reference"], "simple"),
 S+"soundwave/roe-template/SKILL.md": ("Skill tạo tài liệu Rules of Engagement: định nghĩa scope, hành động cấm/cho phép, testing window, contact escalation, quy trình sự cố; generation rules + output.", ["roe","scope","soundwave","template"], "simple"),
 S+"soundwave/roe-template/references/roe-example.json": ("Ví dụ RoE JSON hoàn chỉnh: engagement_name, client, start/end date, engagement_type, testing_window, in_scope/out_of_scope, prohibited/permitted_actions, escalation_contacts, incident_procedure, authorization_reference, version, last_updated — mẫu cấu trúc chuẩn cho skill roe-template.", ["roe","json","example","template"], "simple"),
 S+"soundwave/roe-template/references/validation-checklist.md": ("Checklist validate RoE: trường bắt buộc, scope, boundaries, escalation, bước kiểm tra cuối trước khi dùng.", ["validation","checklist","roe","reference"], "simple"),
 S+"soundwave/structured-questions/SKILL.md": ("Skill dùng ask_user_question — kênh duy nhất nhận input operator cho mọi câu hỏi phỏng vấn, gồm field free-form qua allow_other=true; thói quen gọi đúng signature và ví dụ cụ thể.", ["ask-user-question","hitl","soundwave"], "simple"),
 S+"soundwave/threat-profile/SKILL.md": ("Skill profile hóa threat actor phục vụ adversary emulation: research nhóm APT, tier độ tinh vi, mapping MITRE ATT&CK, initial access vector, archetype tùy chỉnh.", ["threat-profile","apt","emulation"], "simple"),
 S+"soundwave/threat-profile/emulation/SKILL.md": ("Skill routing catalog adversary-emulation: kill chain theo từng actor biến threat profile thành CONOPS phases + OPPLAN objectives; chọn actor, seed plan/threat-profile.json rồi map từng phase sang skill vận hành; giải thích anatomy playbook + discipline.", ["emulation","playbook","routing","soundwave"], "simple"),
 S+"soundwave/threat-profile/emulation/apt29/SKILL.md": ("Skill playbook mô phỏng APT29 (Cozy Bear/Midnight Blizzard, SVR): espionage cloud-identity ít malware — password spray không MFA, lạm dụng OAuth consent/token, Golden SAML, thu thập mailbox qua residential proxy; seed ThreatProfile + kill chain + CONOPS.", ["apt29","golden-saml","oauth-abuse","emulation"], "moderate"),
 S+"soundwave/threat-profile/emulation/fin7/SKILL.md": ("Skill playbook mô phỏng FIN7 (Carbon Spider/Sangria Tempest): spearphishing kèm gọi điện theo sau, tradecraft né EDR, compromise AD, big-game-hunting ransomware; seed ThreatProfile + kill chain + OPSEC fidelity + RoE gates.", ["fin7","ransomware","edr-evasion","emulation"], "simple"),
 S+"soundwave/threat-profile/emulation/lazarus/SKILL.md": ("Skill playbook mô phỏng Lazarus (Hidden Cobra, DPRK RGB): trộm crypto/DeFi + xâm nhập supply chain — social engineering fake-job, app trojanized, đánh cắp wallet/key, khai thác DeFi bridge (chỉ testnet/fork); seed ThreatProfile + kill chain + RoE gates.", ["lazarus","crypto","supply-chain","emulation"], "simple"),
 S+"soundwave/threat-profile/emulation/lockbit/SKILL.md": ("Skill playbook mô phỏng LockBit / RaaS affiliate tổng quát: initial access qua broker/edge/RDP, beacon, compromise AD tới Domain Admin, defense evasion (tắt Defender qua GPO, xóa shadow copy), exfil hàng loạt, mã hóa double-extortion có canary (Windows + ESXi); template tái sử dụng cho ALPHV/Akira/Black Basta.", ["lockbit","raas","ransomware","double-extortion"], "simple"),
}

ALLD = {136: D136, 137: D137, 138: D138, 139: D139, 140: D140}

def node(id_, type_, name, path, lr, summary, tags, cx):
    return {"id": id_, "type": type_, "name": name, "filePath": path,
            "lineRange": lr, "summary": summary, "tags": tags, "complexity": cx}

def edge(src, tgt, type_, weight):
    return {"source": src, "target": tgt, "type": type_, "direction": "forward", "weight": weight}

PARENT = {  # child path -> parent path (docs cross-batch allowed)
 S+"iot/lorawan-otaa/SKILL.md": S+"iot/SKILL.md",
 S+"iot/ros2-dds-attack/SKILL.md": S+"iot/SKILL.md",
 S+"iot/sub-ghz/SKILL.md": S+"iot/SKILL.md",
 S+"iot/z-wave/SKILL.md": S+"iot/SKILL.md",
 S+"iot/zigbee-touchlink/SKILL.md": S+"iot/SKILL.md",
 S+"iot/binwalk-extract/SKILL.md": S+"iot/SKILL.md",
 S+"iot/ble-gatt/SKILL.md": S+"iot/SKILL.md",
 S+"iot/bootloader-uboot/SKILL.md": S+"iot/SKILL.md",
 S+"iot/dev-mem/SKILL.md": S+"iot/SKILL.md",
 S+"iot/firmware-acquisition/SKILL.md": S+"iot/SKILL.md",
 S+"iot/hardcoded-creds/SKILL.md": S+"iot/SKILL.md",
 S+"mobile/android/SKILL.md": S+"mobile/SKILL.md",
 S+"mobile/android/il2cpp/SKILL.md": S+"mobile/android/SKILL.md",
 S+"mobile/flutter/SKILL.md": S+"mobile/SKILL.md",
 S+"mobile/ios/dynamic/SKILL.md": S+"mobile/SKILL.md",
 S+"phisher/evilginx2-proxy/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/gophish-campaign/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/html-smuggling-lure/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/lookalike-domain/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/lure-deconfliction/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/mfa-fatigue-social/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/o365-credential-harvest/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/pdf-credential-harvest/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/pretext-engineering/SKILL.md": S+"phisher/SKILL.md",
 S+"phisher/quishing/SKILL.md": S+"phisher/SKILL.md",
 S+"post-exploit/c2/havoc/SKILL.md": S+"post-exploit/c2/SKILL.md",
 S+"post-exploit/c2/mythic/SKILL.md": S+"post-exploit/c2/SKILL.md",
 S+"recon/web-recon/api-enumeration/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/auth-mapping/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/cms-scanning/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/cookie-audit/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/discovery/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/subdomain-takeover/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"recon/web-recon/waf-detection/SKILL.md": S+"recon/web-recon/SKILL.md",
 S+"reverser/android-malware/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/anti-debug-bypass/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/ctf-triage/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/deep-analysis/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/dotnet-malware/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/fileless-malware/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/firmware/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/fuzzing/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/game-security/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/ghidra/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/ios-static/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/malware-triage/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/packer-unpacking/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/ransomware-analysis/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/rootkit-analysis/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/rop-chain/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/triage/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/virtualized-protectors/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/windows-internals/SKILL.md": S+"reverser/SKILL.md",
 S+"reverser/yara-hunting/SKILL.md": S+"reverser/SKILL.md",
 S+"soundwave/threat-profile/emulation/SKILL.md": S+"soundwave/threat-profile/SKILL.md",
 S+"soundwave/threat-profile/emulation/apt29/SKILL.md": S+"soundwave/threat-profile/emulation/SKILL.md",
 S+"soundwave/threat-profile/emulation/fin7/SKILL.md": S+"soundwave/threat-profile/emulation/SKILL.md",
 S+"soundwave/threat-profile/emulation/lazarus/SKILL.md": S+"soundwave/threat-profile/emulation/SKILL.md",
 S+"soundwave/threat-profile/emulation/lockbit/SKILL.md": S+"soundwave/threat-profile/emulation/SKILL.md",
}

DOCUMENTS = {  # reference md/json -> parent SKILL.md
 S+"post-exploit/c2-sliver/references/sliver-quickstart.md": S+"post-exploit/c2-sliver/SKILL.md",
 S+"post-exploit/credential-access/references/lsass-techniques.md": S+"post-exploit/credential-access/SKILL.md",
 S+"recon/cloud-recon/references/cloud-ip-ranges.md": S+"recon/cloud-recon/SKILL.md",
 S+"recon/cloud-recon/references/cloud-naming-patterns.md": S+"recon/cloud-recon/SKILL.md",
 S+"recon/passive-recon/references/dns-techniques.md": S+"recon/passive-recon/SKILL.md",
 S+"soundwave/conops-template/references/kill-chain-templates.md": S+"soundwave/conops-template/SKILL.md",
 S+"soundwave/opplan-converter/references/objective-rules.md": S+"soundwave/opplan-converter/SKILL.md",
 S+"soundwave/opplan-converter/references/objective-templates.md": S+"soundwave/opplan-converter/SKILL.md",
 S+"soundwave/references/schema-quick-reference.md": S+"soundwave/roe-template/SKILL.md",
 S+"soundwave/roe-template/references/validation-checklist.md": S+"soundwave/roe-template/SKILL.md",
}
EXTRA_DOCUMENTS = [  # (source, target)
 (S+"soundwave/references/schema-quick-reference.md", S+"soundwave/conops-template/SKILL.md"),
 (S+"soundwave/roe-template/SKILL.md", S+"soundwave/roe-template/references/roe-example.json"),
]

PY_FUNCS = {  # path -> [(name, start, end, summary, tags, cx, exported)]
 S+"recon/passive-recon/scripts/parse_subdomains.py": [
   ("extract_subdomains", 16, 19, "Hàm trích danh sách subdomain từ text bằng re.findall với pattern domain, chuyển lowercase; hàm export của script, được main gọi.", ["regex","parsing","export"], "simple"),
   ("main", 22, 67, "Entry point CLI: argparse với 3 tham số (-i input, -o output, tùy chọn), kiểm tra file input tồn tại, đọc từng dòng, gọi extract_subdomains gộp vào set unique, sort và ghi output, in số lượng subdomain tìm được.", ["cli","argparse","io"], "moderate"),
 ],
}

results = {}
for idx in (136, 137, 138, 139, 140):
    b = BATCHES[idx]
    d = ALLD[idx]
    nodes, edges = [], []
    seen_edges = set()

    for f in b["files"]:
        p = f["path"]
        lr = [1, f["sizeLines"]]
        if p.endswith(".md"):
            s, t, cx = d[p]
            nodes.append(node("document:"+p, "document", os.path.basename(p), p, lr, s, t, cx))
        elif p.endswith(".json"):
            s, t, cx = d[p]
            nodes.append(node("config:"+p, "config", os.path.basename(p), p, lr, s, t, cx))
        elif p.endswith(".py"):
            s, t, cx = d[p]
            fid = "file:"+p
            nodes.append(node(fid, "file", os.path.basename(p), p, lr, s, t, cx))
            for (fn, a, z, fs, ft, fcx) in PY_FUNCS[p]:
                nodes.append(node("function:%s:%s" % (p, fn), "function", fn, p, [a, z], fs, ft, fcx))
                k1 = (fid, "function:%s:%s" % (p, fn), "contains")
                if k1 not in seen_edges:
                    seen_edges.add(k1); edges.append(edge(*k1, 1))
                k2 = (fid, "function:%s:%s" % (p, fn), "exports")
                if k2 not in seen_edges:
                    seen_edges.add(k2); edges.append(edge(*k2, 0.8))
            # script belongs to its skill
            k3 = (fid, "document:"+S+"recon/passive-recon/SKILL.md", "related")
            if k3 not in seen_edges:
                seen_edges.add(k3); edges.append(edge(*k3, 0.5))

    # related: child -> parent SKILL.md (docs prefix for md parents, cross-batch ok)
    for p in d:
        if p in PARENT:
            par = PARENT[p]
            k = ("document:"+p, "document:"+par, "related")
            if k not in seen_edges:
                seen_edges.add(k); edges.append(edge(*k, 0.5))

    # documents: reference files -> parent skill (only if the ref is in this batch)
    for ref, par in DOCUMENTS.items():
        if ref not in d:
            continue
        stype = "config:" if ref.endswith(".json") else "document:"
        k = (stype+ref, "document:"+par, "documents")
        if k not in seen_edges:
            seen_edges.add(k); edges.append(edge(*k, 0.5))
    for src, tgt in EXTRA_DOCUMENTS:
        if src not in d:
            continue
        stype = "config:" if src.endswith(".json") else "document:"
        ttype = "config:" if tgt.endswith(".json") else "document:"
        k = (stype+src, ttype+tgt, "documents")
        if k not in seen_edges:
            seen_edges.add(k); edges.append(edge(*k, 0.5))

    # imports 1:1 with batchImportData (empty for these batches -> 0 edges)
    for src_path, targets in b["batchImportData"].items():
        for t in targets:
            edges.append(edge("file:"+src_path, "file:"+t, "imports", 0.7))

    out = {"batchIndex": idx, "batchFiles": b["files"], "nodes": nodes, "edges": edges}
    path = os.path.join(UA, "intermediate", "batch-%d.json" % idx)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    from collections import Counter
    results[idx] = (len(nodes), len(edges), dict(Counter(n["type"] for n in nodes)), dict(Counter(e["type"] for e in edges)))

for idx in (136, 137, 138, 139, 140):
    n, e, nt, et = results[idx]
    print("batch %d: nodes=%d %s | edges=%d %s" % (idx, n, nt, e, et))

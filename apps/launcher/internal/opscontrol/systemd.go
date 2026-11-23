package opscontrol

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// SystemdManager uses a user unit so the daemon shares the operator's Docker access.
type SystemdManager struct {
	UnitName string // e.g. "raptix-opscontrol" or "raptix-opscontrol-stack2"
}

func newSystemdManager() *SystemdManager {
	return &SystemdManager{UnitName: ServiceUnitName()}
}

// systemctlBinary lets tests inject a stub. Defaults to PATH lookup
// of `systemctl`.
var systemctlBinary = "systemctl"

// Available checks for systemctl, a running systemd instance and access to the user manager.
func (s *SystemdManager) Available() bool {
	if _, err := exec.LookPath(systemctlBinary); err != nil {
		return false
	}
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return false
	}
	if err := exec.Command(systemctlBinary, "--user", "--version").Run(); err != nil {
		return false
	}
	return true
}

func (s *SystemdManager) Name() string { return "systemd-user" }

func (s *SystemdManager) unitPath() (string, error) {
	dir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("opscontrol: resolve user home: %w", err)
	}
	return filepath.Join(dir, ".config", "systemd", "user", s.UnitName+".service"), nil
}

func (s *SystemdManager) Installed() (bool, error) {
	p, err := s.unitPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(p)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// Active accepts only the active state. An activating service may lack a socket.
func (s *SystemdManager) Active() (bool, error) {
	out, err := exec.Command(systemctlBinary, "--user", "is-active", s.UnitName+".service").Output()
	state := strings.TrimSpace(string(out))
	if err != nil {
		// Inactive and failed are valid states even when systemctl exits nonzero.
		if state == "" {
			return false, nil
		}
		return false, nil
	}
	return state == "active", nil
}

// Install writes (or re-writes) the unit file and enables + starts
// the service. Idempotent.
func (s *SystemdManager) Install(spec InstallSpec) error {
	if spec.BinaryPath == "" || spec.HomePath == "" {
		return errors.New("opscontrol: InstallSpec requires BinaryPath and HomePath")
	}
	unitDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("opscontrol: resolve user home: %w", err)
	}
	unitDir = filepath.Join(unitDir, ".config", "systemd", "user")
	if err := os.MkdirAll(unitDir, 0o755); err != nil {
		return fmt.Errorf("opscontrol: create systemd user dir: %w", err)
	}

	// Drop-ins survive reinstall and can override ExecStart. Remove only those pointing to missing binaries.
	dropInRemoved := s.removeStaleDropIns(filepath.Join(unitDir, s.UnitName+".service.d"))

	unit := s.renderUnit(spec)
	unitFile := filepath.Join(unitDir, s.UnitName+".service")
	if err := os.WriteFile(unitFile, []byte(unit), 0o644); err != nil {
		return fmt.Errorf("opscontrol: write unit: %w", err)
	}

	if out, err := exec.Command(systemctlBinary, "--user", "daemon-reload").CombinedOutput(); err != nil {
		return fmt.Errorf("opscontrol: daemon-reload: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if dropInRemoved {
		// Reload once for the rewritten unit and any removed drop-ins.
		_ = exec.Command(systemctlBinary, "--user", "reset-failed", s.UnitName+".service").Run()
	}
	if out, err := exec.Command(systemctlBinary, "--user", "enable", "--now", s.UnitName+".service").CombinedOutput(); err != nil {
		return fmt.Errorf("opscontrol: enable --now: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// removeStaleDropIns deletes only .conf overrides with an ExecStart binary missing on disk.
func (s *SystemdManager) removeStaleDropIns(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	removed := false
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".conf") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, raw := range strings.Split(string(body), "\n") {
			line := strings.TrimSpace(raw)
			if !strings.HasPrefix(line, "ExecStart=") {
				continue
			}
			// Strip the `ExecStart=` prefix and any leading modifier
			// characters systemd accepts (`-`, `@`, `:`, `+`, `!`, `!!`).
			value := strings.TrimLeft(strings.TrimPrefix(line, "ExecStart="), "-@:+!")
			fields := strings.Fields(value)
			if len(fields) == 0 {
				continue
			}
			binaryPath := fields[0]
			if _, err := os.Stat(binaryPath); errors.Is(err, os.ErrNotExist) {
				fmt.Fprintf(os.Stderr,
					"opscontrol: removing stale drop-in %s — ExecStart=%s no longer exists\n",
					path, binaryPath)
				if err := os.Remove(path); err == nil {
					removed = true
				}
				break
			}
		}
	}
	// If the drop-in dir is now empty, remove it so a future
	// `systemctl edit` starts from a clean slate.
	if remaining, err := os.ReadDir(dir); err == nil && len(remaining) == 0 {
		_ = os.Remove(dir)
	}
	return removed
}

func (s *SystemdManager) Uninstall() error {
	// best-effort stop+disable so re-running uninstall after a manual
	// `systemctl stop` doesn't error.
	_ = exec.Command(systemctlBinary, "--user", "disable", "--now", s.UnitName+".service").Run()

	p, err := s.unitPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("opscontrol: remove unit file: %w", err)
	}
	// daemon-reload so systemd forgets the unit before another
	// install reuses the path.
	_ = exec.Command(systemctlBinary, "--user", "daemon-reload").Run()
	return nil
}

func (s *SystemdManager) Start() error {
	installed, err := s.Installed()
	if err != nil {
		return err
	}
	if !installed {
		return ErrNotInstalled
	}
	if out, err := exec.Command(systemctlBinary, "--user", "start", s.UnitName+".service").CombinedOutput(); err != nil {
		return fmt.Errorf("opscontrol: systemctl start: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (s *SystemdManager) Stop() error {
	// stop is fine to call even on a not-installed unit; systemctl
	// returns 0 with a warning. We swallow the warning.
	_ = exec.Command(systemctlBinary, "--user", "stop", s.UnitName+".service").Run()
	return nil
}

// renderUnit keeps system and home paths read-only where possible while allowing Docker configuration reads.
// Leave PrivateTmp off so launcher binaries built under /tmp remain executable by the service.
func (s *SystemdManager) renderUnit(spec InstallSpec) string {
	stackEnv := ""
	if spec.StackName != "" {
		stackEnv = fmt.Sprintf("Environment=RAPTIX_STACK_NAME=%s\n", spec.StackName)
	}
	// Use the launcher working directory and .env so the daemon's Compose calls preserve container configuration.
	return fmt.Sprintf(`[Unit]
Description=Raptix opscontrol daemon (ADR-0006)
Documentation=https://github.com/Akapi895/raptix/blob/main/docs/security/sandbox-isolation.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s opscontrol daemon
WorkingDirectory=%s
EnvironmentFile=-%s/.env
Environment=RAPTIX_HOME=%s
%sRestart=on-failure
RestartSec=5s
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=%s
SyslogIdentifier=%s

[Install]
WantedBy=default.target
`, spec.BinaryPath, spec.HomePath, spec.HomePath, spec.HomePath, stackEnv, spec.HomePath, s.UnitName)
}

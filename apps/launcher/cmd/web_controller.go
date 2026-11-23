package cmd

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/sandboxes"
	"github.com/spf13/cobra"
)

// controllerFlags are shared by web start and web sandboxes start.
type controllerFlags struct {
	secretsDir string
	network    string
	image      string
	listen     string
}

func addControllerFlags(cmd *cobra.Command, f *controllerFlags) {
	fl := cmd.Flags()
	fl.StringVar(&f.secretsDir, "sandbox-secrets-dir", "", "directory holding the sandbox key and the controller token (default: RAPTIX_SANDBOX_SECRETS_DIR, else <Raptix home>/sandbox-secrets)")
	fl.StringVar(&f.network, "sandbox-network", "", "existing sandbox network project sandboxes join (default: RAPTIX_STACK_SANDBOX_NETWORK, else raptix_sandbox-net)")
	fl.StringVar(&f.image, "sandbox-image", "", "sandbox image reference (default: ghcr.io/akapi895/raptix-sandbox:<RAPTIX_VERSION|stable>)")
	fl.StringVar(&f.listen, "sandbox-listen", "", "address the controller serves on (default: 127.0.0.1:9200)")
}

// controllerSettings configures the detached host process and its PID and log paths.
type controllerSettings struct {
	home       string
	secretsDir string
	network    string
	image      string
	listen     string
}

func controllerDir(s controllerSettings) string {
	return filepath.Join(s.home, "web-sandboxes")
}

func controllerPIDPath(s controllerSettings) string {
	return filepath.Join(controllerDir(s), "controller.pid")
}

func controllerLogPath(s controllerSettings) string {
	return filepath.Join(controllerDir(s), "controller.log")
}

// loadStackEnv reads the first available .env from the checkout or installation.
func loadStackEnv() (map[string]string, error) {
	for _, path := range []string{".env", filepath.Join(config.RaptixHome(), ".env")} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		return config.LoadEnv(path)
	}
	return map[string]string{}, nil
}

// resolveControllerSettings uses flags, process env, deployment .env, then defaults.
// The secrets directory's parent becomes the controller home.
func resolveControllerSettings(flags controllerFlags) (controllerSettings, error) {
	env, err := loadStackEnv()
	if err != nil {
		return controllerSettings{}, err
	}
	pick := func(flagValue, envKey, fallback string) string {
		if flagValue != "" {
			return flagValue
		}
		if v := os.Getenv(envKey); v != "" {
			return v
		}
		if v := env[envKey]; v != "" {
			return v
		}
		return fallback
	}
	secretsDir := pick(flags.secretsDir, "RAPTIX_SANDBOX_SECRETS_DIR", filepath.Join(config.RaptixHome(), "sandbox-secrets"))
	version := pick("", "RAPTIX_VERSION", "stable")
	return controllerSettings{
		home:       filepath.Dir(secretsDir),
		secretsDir: secretsDir,
		network:    pick(flags.network, "RAPTIX_STACK_SANDBOX_NETWORK", "raptix_sandbox-net"),
		image:      pick(flags.image, "", "ghcr.io/akapi895/raptix-sandbox:"+version),
		listen:     pick(flags.listen, "", "127.0.0.1:9200"),
	}, nil
}

// ensureSandboxController reuses a healthy process or starts one and waits for its listener.
// Missing secrets are initialized without rotating existing keys.
func ensureSandboxController(out io.Writer, s controllerSettings) error {
	if err := sandboxes.InitSecrets(s.secretsDir); err != nil {
		return err
	}
	dir := controllerDir(s)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	pidPath := controllerPIDPath(s)
	if pid, alive := readControllerPID(pidPath); alive {
		fmt.Fprintf(out, "sandbox controller already running (pid %d, listening on %s)\n", pid, s.listen)
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate launcher binary: %w", err)
	}
	cmd := exec.Command(exe, //nolint:gosec // the launcher re-executes itself with resolved flags
		"web", "sandboxes", "serve",
		"--home", s.home,
		"--secrets-dir", s.secretsDir,
		"--network", s.network,
		"--image", s.image,
		"--listen", s.listen,
	)
	cmd.Stdin = nil
	logf, err := os.OpenFile(controllerLogPath(s), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err == nil {
		defer logf.Close()
		cmd.Stdout = logf
		cmd.Stderr = logf
	}
	setControllerDetached(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn sandbox controller: %w", err)
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		return fmt.Errorf("write %s: %w", pidPath, err)
	}
	if err := waitForController(s.listen, 15*time.Second); err != nil {
		return fmt.Errorf("sandbox controller (pid %d) did not accept on %s: %w (see %s)",
			pid, s.listen, err, controllerLogPath(s))
	}
	fmt.Fprintf(out, "sandbox controller running (pid %d, listening on %s)\n", pid, s.listen)
	return nil
}

// stopSandboxController stops the host process while leaving project sandboxes running.
func stopSandboxController(s controllerSettings) error {
	pidPath := controllerPIDPath(s)
	pid, alive := readControllerPID(pidPath)
	if !alive {
		_ = os.Remove(pidPath)
		return nil
	}
	if err := killControllerProcess(pid); err != nil {
		return fmt.Errorf("stop sandbox controller (pid %d): %w", pid, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, still := readControllerPID(pidPath); !still {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("sandbox controller (pid %d) did not exit within 5s", pid)
}

// controllerStatus returns a one-line state for `web status`.
func controllerStatus(s controllerSettings) string {
	pid, alive := readControllerPID(controllerPIDPath(s))
	if !alive {
		return "sandbox controller: not running"
	}
	if err := waitForController(s.listen, time.Second); err != nil {
		return fmt.Sprintf("sandbox controller: pid %d alive but not accepting on %s", pid, s.listen)
	}
	return fmt.Sprintf("sandbox controller: running (pid %d, listening on %s)", pid, s.listen)
}

// readControllerPID treats a stale PID file as stopped.
func readControllerPID(path string) (int, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, controllerProcessAlive(pid)
}

// waitForController polls the controller's TCP listener; it is the health
// check both after spawning and in `web status`.
func waitForController(addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, time.Second)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		lastErr = err
		time.Sleep(200 * time.Millisecond)
	}
	return lastErr
}

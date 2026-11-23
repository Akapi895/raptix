package cmd

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/cmd/opscontrol"
	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/engagement"
	"github.com/Akapi895/raptix/apps/launcher/internal/health"
	"github.com/Akapi895/raptix/apps/launcher/internal/migrate"
	"github.com/Akapi895/raptix/apps/launcher/internal/platform"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
	"github.com/Akapi895/raptix/apps/launcher/internal/updater"
	"github.com/spf13/cobra"
)

func nullDevice() string {
	if runtime.GOOS == "windows" {
		return "NUL"
	}
	return "/dev/null"
}

// Indirected so tests can swap WSL detection without touching the
// real /proc/version or /etc/resolv.conf on the host they run on.
var (
	isWSLFn     = platform.IsWSL
	wslHostIPFn = platform.WSLHostIP

	// Indirected so tests can assert which AUTO_UPDATE branch ran
	// without making network calls into GitHub.
	autoUpdateFn   = updater.AutoUpdateIfAvailable
	promptUpdateFn = updater.PromptIfUpdateAvailable
)

// applyAutoUpdate honors --no-update before AUTO_UPDATE. Unknown values use the prompt path.
func applyAutoUpdate(env map[string]string, version string, skip bool) {
	if skip {
		return
	}
	// Which release stream to track (stable | latest). Default stable.
	ch := updater.ResolveChannel(config.Get(env, "RAPTIX_CHANNEL", ""))
	switch strings.ToLower(strings.TrimSpace(config.Get(env, "AUTO_UPDATE", ""))) {
	case "", "true", "1", "yes", "on":
		if _, err := autoUpdateFn(version, ch); err != nil {
			ui.Warning("Auto-update: " + err.Error())
		}
	case "false", "0", "no", "off":
		// self-update disabled
	default:
		// Includes the explicit `prompt` / `ask` / `interactive`
		// opt-ins AND any unrecognized value (safer fallback).
		if _, err := promptUpdateFn(version, ch); err != nil {
			ui.Warning("Update check: " + err.Error())
		}
	}
}

var skipUpdate bool

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start Raptix services and the Web console",
	RunE:  runStart,
}

func init() {
	rootCmd.AddCommand(startCmd)

	// The root flag covers both implicit and explicit start.
	rootCmd.PersistentFlags().BoolVar(&skipUpdate, "no-update", false,
		"Skip the self-update check for this launch (does not change AUTO_UPDATE in .env)")

	rootCmd.RunE = func(cmd *cobra.Command, args []string) error {
		return runStart(cmd, args)
	}
}

func runStart(cmd *cobra.Command, args []string) error {
	if !config.EnvExists() {
		ui.Warning("No configuration found. Running setup wizard...")
		fmt.Println()
		if err := runOnboard(cmd, nil); err != nil {
			return err
		}
		fmt.Println()
	}

	// Migrate the legacy default profile before loading .env so optional workloads stay off at boot.
	if rewrote, mErr := config.MigrateActiveComposeProfiles(config.EnvPath()); mErr != nil {
		ui.Warning("Could not migrate stale COMPOSE_PROFILES in .env: " + mErr.Error())
	} else if rewrote {
		ui.Info("Migrated stale COMPOSE_PROFILES in .env (specialist workloads now spawn via ops_start). Backup at " + config.EnvPath() + ".bak")
	}

	env, err := config.LoadEnv(config.EnvPath())
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// Run config migrations for existing installations. Interactive steps wait for a TTY.
	migrate.RunAll(env)

	if err := config.ValidateAuth(env); err != nil {
		return err
	}

	// Verify Docker is available
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("Docker is not installed or not in PATH. Install from https://docs.docker.com/get-docker/")
	}
	// Verify Docker Compose V2
	out, err := exec.Command("docker", "compose", "version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("Docker Compose V2 is required. Got: %s. Upgrade Docker Desktop or install the compose plugin.", strings.TrimSpace(string(out)))
	}

	// Probe Ollama from the host with a translated URL. LiteLLM still uses the configured URL.
	probeOllamaIfSelected(env)

	home := config.RaptixHome()
	composePath := filepath.Join(home, "docker-compose.yml")
	if _, err := os.Stat(composePath); os.IsNotExist(err) {
		// Use installed version tag; fall back to branch for dev builds
		ref := "v" + version
		if version == "dev" || version == "" {
			ref = config.Get(env, "RAPTIX_BRANCH", "main")
		}
		ui.Info("Downloading configuration files...")
		// Recovery without release metadata downloads config without checksum verification and warns.
		if err := updater.SyncConfigFiles(ref, nil); err != nil {
			return fmt.Errorf("sync config: %w", err)
		}
	}

	// Ensure workspace directory exists
	_ = os.MkdirAll(filepath.Join(home, "workspace"), 0o755)

	// Ensure RAPTIX_HOME is set in .env (Docker Compose needs absolute path)
	if config.Get(env, "RAPTIX_HOME", "") == "" {
		env["RAPTIX_HOME"] = home
		if err := config.AppendEnvLine(config.EnvPath(), "RAPTIX_HOME", home); err != nil {
			ui.Warning("Could not set RAPTIX_HOME in .env: " + err.Error())
		}
	}

	// Use the null device when credentials are absent so Docker cannot create a directory at the mount source.
	userHome, homeErr := os.UserHomeDir()
	if homeErr != nil {
		// Skip optional credential mounts if the home directory is unknown.
		ui.Warning("Could not resolve home directory; skipping host credential mounts: " + homeErr.Error())
		_ = os.Setenv("CLAUDE_CREDENTIALS_VOLUME", nullDevice())
		_ = os.Setenv("CODEX_AUTH_VOLUME", nullDevice())
	} else {
		credsPath := filepath.Join(userHome, ".claude", ".credentials.json")
		if _, statErr := os.Stat(credsPath); statErr == nil {
			_ = os.Setenv("CLAUDE_CREDENTIALS_VOLUME", credsPath)
		} else {
			_ = os.Setenv("CLAUDE_CREDENTIALS_VOLUME", nullDevice())
		}

		// Mount the host Codex credential store so the container can use host logins.
		codexAuthPath := filepath.Join(userHome, ".codex", "auth.json")
		if _, statErr := os.Stat(codexAuthPath); statErr == nil {
			_ = os.Setenv("CODEX_AUTH_VOLUME", codexAuthPath)
		} else {
			_ = os.Setenv("CODEX_AUTH_VOLUME", nullDevice())
		}
	}

	// Apply updates before startup continues because the updater may replace the current process.
	applyAutoUpdate(env, version, skipUpdate)

	// Select the engagement before Compose binds its workspace.
	fmt.Println()
	choice, err := engagement.Select(home)
	if err != nil {
		return err
	}
	// Export the bind path. composeEnv() forwards os.Environ(), so docker
	// compose interpolates ${RAPTIX_ENGAGEMENT_WORKSPACE} from this var.
	if err := os.Setenv("RAPTIX_ENGAGEMENT_WORKSPACE", choice.WorkspacePath); err != nil {
		return fmt.Errorf("set engagement workspace env: %w", err)
	}
	// Pass the engagement slug to both containers so workspace boundaries match.
	if err := os.Setenv("RAPTIX_ENGAGEMENT", choice.Engagement); err != nil {
		return fmt.Errorf("set engagement slug env: %w", err)
	}

	// Start the daemon before Compose mounts its socket.
	sock, err := opscontrol.EnsureRunning()
	if err != nil {
		// Startup can continue without the daemon. Optional workloads remain unavailable.
		ui.Warning("opscontrol daemon not started: " + err.Error())
	} else if err := os.Setenv("RAPTIX_OPSCONTROL_SOCK_HOST", sock); err != nil {
		ui.Warning("set RAPTIX_OPSCONTROL_SOCK_HOST: " + err.Error())
	}

	// Reject the bundled fallback credentials before starting services.
	if err := checkDefaultCredentials(env); err != nil {
		return err
	}

	c := compose.New()

	ui.Info("Starting Raptix services...")
	if err := c.Up(); err != nil {
		return fmt.Errorf("start services: %w", err)
	}

	if err := health.WaitForServices(env); err != nil {
		return err
	}

	port := config.Get(env, "UI_PORT", "5173")
	if override := os.Getenv("UI_PORT"); override != "" {
		port = override
	}
	ui.Success("Raptix Web console: http://127.0.0.1:" + port)
	return nil
}

// checkDefaultCredentials rejects the credentials a bare Compose run uses by default.
func checkDefaultCredentials(env map[string]string) error {
	defaults := map[string][]string{
		"LITELLM_MASTER_KEY": {"sk-raptix-master"},
		"LITELLM_SALT_KEY":   {"sk-raptix-salt-change-me", "sk-raptix-salt"},
		"POSTGRES_PASSWORD":  {"raptix"},
		"NEO4J_PASSWORD":     {"raptix-graph"},
	}
	insecure := make([]string, 0, len(defaults))
	for name, fallbacks := range defaults {
		value := strings.TrimSpace(config.Get(env, name, ""))
		if value == "" || slices.Contains(fallbacks, value) {
			insecure = append(insecure, name)
		}
	}
	if len(insecure) == 0 {
		return nil
	}
	slices.Sort(insecure)
	return fmt.Errorf(
		"refusing to start with missing or default credentials in %s: %s.\n"+
			"For a new install, delete %s and run `raptix onboard`.\n"+
			"For an initialized install, do not change database passwords in .env alone; "+
			"back up the engagement, run `raptix remove`, then onboard again so credentials and volumes are recreated together.",
		config.EnvPath(), strings.Join(insecure, ", "), config.EnvPath())
}

func probeOllamaIfSelected(env map[string]string) {
	priority := strings.ToLower(env["RAPTIX_AUTH_PRIORITY"])
	hasOllama := strings.Contains(","+priority+",", ",ollama_local,")
	base := strings.TrimSpace(env["OLLAMA_API_BASE"])
	if !hasOllama && base == "" {
		return
	}
	if base == "" {
		ui.Warning("ollama_local selected but OLLAMA_API_BASE is empty — skipping reachability probe.")
		return
	}

	candidates := candidateProbeURLs(base)
	client := &http.Client{Timeout: 2 * time.Second}
	var lastStatus int
	for _, candidate := range candidates {
		resp, err := client.Get(candidate + "/api/tags")
		if err != nil {
			continue
		}
		status := resp.StatusCode
		resp.Body.Close()
		if status < 400 {
			ui.DimText(fmt.Sprintf("Ollama reachable at %s.", base))
			return
		}
		lastStatus = status
	}

	if lastStatus != 0 {
		ui.Warning(fmt.Sprintf(
			"Ollama responded with %d at %s — verify the URL is correct.",
			lastStatus, base,
		))
		return
	}
	ui.Warning(fmt.Sprintf(
		"Ollama not reachable at %s (host-side probe). "+
			"Start it with 'ollama serve' or check OLLAMA_API_BASE.",
		base,
	))
}

// candidateProbeURLs tries the configured address first. For host.docker.internal,
// it also tries the Windows host on WSL and then loopback.
func candidateProbeURLs(raw string) []string {
	u, err := url.Parse(raw)
	if err != nil {
		return []string{raw}
	}
	host, port, splitErr := net.SplitHostPort(u.Host)
	if splitErr != nil {
		host = u.Host
		port = ""
	}
	if host != "host.docker.internal" {
		return []string{raw}
	}

	candidates := []string{raw}
	seen := map[string]struct{}{raw: {}}
	add := func(replacement string) {
		v := *u
		if port == "" {
			v.Host = replacement
		} else {
			v.Host = net.JoinHostPort(replacement, port)
		}
		s := v.String()
		if _, dup := seen[s]; dup {
			return
		}
		seen[s] = struct{}{}
		candidates = append(candidates, s)
	}

	if isWSLFn() {
		if hostIP := wslHostIPFn(); hostIP != "" {
			add(hostIP)
		}
	}
	add("127.0.0.1")
	return candidates
}

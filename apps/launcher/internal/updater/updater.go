package updater

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"charm.land/huh/v2"
	"golang.org/x/term"

	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
)

// ConfigManifestAsset names the release checksum manifest for configuration files.
const ConfigManifestAsset = "config-checksums.txt"

// BinaryChecksumsAsset is GoReleaser's binary checksum manifest. Same
// "<hex>  <name>" format as ConfigManifestAsset.
const BinaryChecksumsAsset = "checksums.txt"

const Repo = "Akapi895/raptix"

var RawBaseURL = "https://raw.githubusercontent.com/" + Repo

// APIBaseURL is a var (not const) so tests can point release fetches at
// an httptest server.
var APIBaseURL = "https://api.github.com/repos/" + Repo

// executableFn lets tests replace a temporary binary in place of the running test binary.
var executableFn = os.Executable

// Channel selects final releases. Stable waits for the soak window. Latest tracks new releases immediately.
type Channel string

const (
	ChannelStable Channel = "stable"
	ChannelLatest Channel = "latest"
)

// nowFn is injectable so tests can pin "now" for stable soak math.
var nowFn = time.Now

// stableSoak is the promotion delay and can be overridden with RAPTIX_STABLE_SOAK_DAYS.
var stableSoak = resolveStableSoak()

func resolveStableSoak() time.Duration {
	const def = 7 * 24 * time.Hour
	raw := strings.TrimSpace(os.Getenv("RAPTIX_STABLE_SOAK_DAYS"))
	if raw == "" {
		return def
	}
	var days float64
	if _, err := fmt.Sscanf(raw, "%f", &days); err != nil || days < 0 {
		return def
	}
	return time.Duration(days * 24 * float64(time.Hour))
}

// ResolveChannel defaults to stable for empty or unrecognized values.
func ResolveChannel(raw string) Channel {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(ChannelLatest):
		return ChannelLatest
	default:
		return ChannelStable
	}
}

// Release represents a GitHub release.
type Release struct {
	TagName     string  `json:"tag_name"`
	Assets      []Asset `json:"assets"`
	Prerelease  bool    `json:"prerelease"`
	Draft       bool    `json:"draft"`
	PublishedAt string  `json:"published_at"`
}

// Asset represents a release asset (binary download).
type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// FetchRelease selects a final release. Stable falls back to latest if no release has aged enough.
func FetchRelease(ch Channel) (*Release, error) {
	if ch == ChannelStable {
		return fetchSoakedStable()
	}
	return fetchLatestFinal()
}

func fetchLatestFinal() (*Release, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(APIBaseURL + "/releases/latest")
	if err != nil {
		return nil, fmt.Errorf("fetch release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release Release
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}
	return &release, nil
}

func fetchSoakedStable() (*Release, error) {
	releases, err := listReleases()
	if err != nil {
		return nil, err
	}
	if r := pickSoakedStable(releases, nowFn(), stableSoak); r != nil {
		return r, nil
	}
	return fetchLatestFinal()
}

func listReleases() ([]Release, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(APIBaseURL + "/releases?per_page=30")
	if err != nil {
		return nil, fmt.Errorf("fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var releases []Release
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("decode releases: %w", err)
	}
	return releases, nil
}

// pickSoakedStable returns the highest final version that meets the age requirement, or nil.
func pickSoakedStable(releases []Release, now time.Time, soak time.Duration) *Release {
	cutoff := now.Add(-soak)
	var best *Release
	for i := range releases {
		r := &releases[i]
		if r.Draft || r.Prerelease || r.TagName == "" {
			continue
		}
		pub, err := time.Parse(time.RFC3339, r.PublishedAt)
		if err != nil || pub.After(cutoff) {
			continue // unparseable timestamp, or not yet soaked
		}
		if best == nil || compareSemver(
			strings.TrimPrefix(best.TagName, "v"),
			strings.TrimPrefix(r.TagName, "v"),
		) < 0 {
			best = r
		}
	}
	return best
}

// CompareVersions returns true if latest > current using numeric semver comparison.
func CompareVersions(current, latest string) bool {
	current = strings.TrimPrefix(current, "v")
	latest = strings.TrimPrefix(latest, "v")
	if current == "dev" || current == "" {
		return false // Dev builds do not track published releases.
	}
	return compareSemver(current, latest) < 0
}

// compareSemver compares version precedence and ignores build metadata.
func compareSemver(a, b string) int {
	aBase, aPre := splitPrerelease(a)
	bBase, bPre := splitPrerelease(b)
	if c := compareNumericBase(aBase, bBase); c != 0 {
		return c
	}
	// Bases equal — apply prerelease precedence.
	switch {
	case aPre == "" && bPre == "":
		return 0
	case aPre == "":
		return 1 // a is a normal version, b is a prerelease → a > b
	case bPre == "":
		return -1 // a is a prerelease, b is a normal version → a < b
	default:
		return comparePrerelease(aPre, bPre)
	}
}

// splitPrerelease strips build metadata and splits “base-prerelease“.
func splitPrerelease(v string) (base, pre string) {
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	if i := strings.IndexByte(v, '-'); i >= 0 {
		return v[:i], v[i+1:]
	}
	return v, ""
}

// compareNumericBase compares the major.minor.patch triple numerically.
func compareNumericBase(a, b string) int {
	aParts := strings.SplitN(a, ".", 3)
	bParts := strings.SplitN(b, ".", 3)
	for i := 0; i < 3; i++ {
		var av, bv int
		if i < len(aParts) {
			fmt.Sscanf(aParts[i], "%d", &av)
		}
		if i < len(bParts) {
			fmt.Sscanf(bParts[i], "%d", &bv)
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return 0
}

// comparePrerelease follows SemVer precedence for numeric and text identifiers.
func comparePrerelease(a, b string) int {
	aIDs := strings.Split(a, ".")
	bIDs := strings.Split(b, ".")
	for i := 0; i < len(aIDs) && i < len(bIDs); i++ {
		ai, bi := aIDs[i], bIDs[i]
		aNum, aIsNum := parseUint(ai)
		bNum, bIsNum := parseUint(bi)
		switch {
		case aIsNum && bIsNum:
			if aNum != bNum {
				if aNum < bNum {
					return -1
				}
				return 1
			}
		case aIsNum && !bIsNum:
			return -1 // numeric identifiers have lower precedence
		case !aIsNum && bIsNum:
			return 1
		default:
			if ai != bi {
				if ai < bi {
					return -1
				}
				return 1
			}
		}
	}
	switch {
	case len(aIDs) < len(bIDs):
		return -1
	case len(aIDs) > len(bIDs):
		return 1
	default:
		return 0
	}
}

// parseUint reports whether s is all-digits and its value if so.
func parseUint(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
	}
	return n, true
}

// SyncConfigFiles verifies all downloads against release checksums when a manifest exists.
// Branch installs and releases without a manifest use the unverified fallback with a warning.
func SyncConfigFiles(branch string, release *Release) error {
	home := config.RaptixHome()
	files := map[string]string{
		// The launcher writes the opscontrol overlay locally, so it is excluded from downloads.
		"docker-compose.yml":        filepath.Join(home, "docker-compose.yml"),
		"infra/config/litellm.yaml": filepath.Join(home, "infra", "config", "litellm.yaml"),
	}

	client := &http.Client{Timeout: 30 * time.Second}

	manifest, err := fetchManifest(client, release, ConfigManifestAsset)
	if err != nil {
		return err
	}

	// Verify all downloads before replacing any installed configuration file.
	for src, dst := range files {
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return fmt.Errorf("%s: prepare directory: %w", src, err)
		}
		url := fmt.Sprintf("%s/%s/%s", RawBaseURL, branch, src)
		tmp := dst + ".tmp"
		defer os.Remove(tmp)
		if err := downloadFile(client, url, tmp); err != nil {
			return fmt.Errorf("%s: %w", src, err)
		}
		if manifest != nil {
			if err := verifyAgainstManifest(tmp, src, manifest); err != nil {
				return fmt.Errorf("%s: %w", src, err)
			}
		}
	}
	for src, dst := range files {
		if err := os.Rename(dst+".tmp", dst); err != nil {
			return fmt.Errorf("%s: rename: %w", src, err)
		}
		ui.Success("Updated " + src)
	}
	return nil
}

// fetchManifest loads the release checksum map. A missing release or asset yields a nil map.
func fetchManifest(client *http.Client, release *Release, assetName string) (map[string]string, error) {
	if release == nil {
		ui.Warning("No release pinned for sync — skipping checksum verification (branch mode).")
		return nil, nil
	}
	url := assetURL(release, assetName)
	if url == "" {
		ui.Warning(fmt.Sprintf(
			"%s missing from release %s — skipping checksum verification (pre-1.0.27 release).",
			assetName, release.TagName,
		))
		return nil, nil
	}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", assetName, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: HTTP %d", assetName, resp.StatusCode)
	}
	return parseChecksumManifest(resp.Body)
}

// parseChecksumManifest accepts sha256sum format and rejects malformed entries.
func parseChecksumManifest(r io.Reader) (map[string]string, error) {
	out := map[string]string{}
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		// Accept the optional sha256sum binary-mode marker before a path.
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return nil, fmt.Errorf("malformed manifest line: %q", line)
		}
		hash := fields[0]
		path := strings.TrimPrefix(strings.Join(fields[1:], " "), "*")
		out[path] = hash
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	return out, nil
}

// verifyAgainstManifest computes the sha256 of dst and compares it
// against the entry for “manifestPath“ in the supplied manifest map.
func verifyAgainstManifest(dst, manifestPath string, manifest map[string]string) error {
	expected, ok := manifest[manifestPath]
	if !ok {
		return fmt.Errorf("no checksum entry for %q in manifest", manifestPath)
	}
	actual, err := sha256File(dst)
	if err != nil {
		return fmt.Errorf("hash %s: %w", dst, err)
	}
	if actual != expected {
		return fmt.Errorf("checksum mismatch for %s\n  expected: %s\n  got:      %s", manifestPath, expected, actual)
	}
	return nil
}

// sha256File returns the lower-case hex SHA-256 of path's contents.
func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// assetURL returns the browser_download_url for the named asset, or "".
func assetURL(release *Release, name string) string {
	if release == nil {
		return ""
	}
	for _, a := range release.Assets {
		if a.Name == name {
			return a.BrowserDownloadURL
		}
	}
	return ""
}

// downloadFile fetches a URL and writes it to dst, closing the body properly.
func downloadFile(client *http.Client, url, dst string) error {
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}

	return os.WriteFile(dst, data, 0o600)
}

// CleanupOldBinary removes the Windows backup on a best-effort basis.
// The previous process may still hold it open during restart.
func CleanupOldBinary() {
	if runtime.GOOS != "windows" {
		return
	}
	execPath, err := executableFn()
	if err != nil {
		return
	}
	_ = os.Remove(execPath + ".old")
}

func replaceExecutable(tmpPath, execPath string) error {
	if runtime.GOOS != "windows" {
		return os.Rename(tmpPath, execPath)
	}

	oldPath := execPath + ".old"
	if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove previous backup: %w", err)
	}
	if err := os.Rename(execPath, oldPath); err != nil {
		return fmt.Errorf("backup running binary: %w", err)
	}
	if err := os.Rename(tmpPath, execPath); err != nil {
		if rollbackErr := os.Rename(oldPath, execPath); rollbackErr != nil {
			return fmt.Errorf("install new binary: %w (rollback failed: %v)", err, rollbackErr)
		}
		return fmt.Errorf("install new binary: %w", err)
	}
	return nil
}

// SelfUpdate verifies the binary before replacement when the release has a checksum manifest.
// Older releases without checksums use the legacy path and emit a warning.
func SelfUpdate(release *Release) error {
	assetName := fmt.Sprintf("raptix-%s-%s", runtime.GOOS, runtime.GOARCH)

	downloadURL := assetURL(release, assetName)
	if downloadURL == "" {
		return fmt.Errorf("no binary found for %s/%s in release %s", runtime.GOOS, runtime.GOARCH, release.TagName)
	}

	ui.Info("Downloading " + assetName + "...")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download binary: HTTP %d", resp.StatusCode)
	}

	// Write to temp file first
	execPath, err := executableFn()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	tmpPath := execPath + ".tmp"
	// Keep the temporary binary private and non-executable until verification.
	tmp, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write binary: %w", err)
	}
	tmp.Close()

	// Warn when legacy releases lack a checksum manifest.
	manifest, err := fetchManifest(client, release, BinaryChecksumsAsset)
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("fetch binary checksums: %w", err)
	}
	if manifest != nil {
		if err := verifyAgainstManifest(tmpPath, assetName, manifest); err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("verify binary: %w", err)
		}
	}

	// Verification passed — make the binary executable before renaming.
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod temp file: %w", err)
	}

	// Atomic replace on POSIX. Windows first moves the running image aside
	// because an executable cannot be overwritten while it is in use.
	if err := replaceExecutable(tmpPath, execPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("replace binary: %w", err)
	}

	ui.Success("Binary updated to " + release.TagName)
	return nil
}

// WriteVersion writes the version to .version file.
func WriteVersion(version string) error {
	versionFile := filepath.Join(config.RaptixHome(), ".version")
	return os.WriteFile(versionFile, []byte(strings.TrimPrefix(version, "v")), 0o644)
}

// NotifyIfUpdateAvailable prints an update notice without modifying the installation.
func NotifyIfUpdateAvailable(currentVersion string, ch Channel) bool {
	release, err := FetchRelease(ch)
	if err != nil {
		return false // Silent fail; startup should not depend on GitHub.
	}

	if !CompareVersions(currentVersion, release.TagName) {
		return false
	}

	ui.Info(fmt.Sprintf("Update available: %s -> %s", displayVersion(currentVersion), release.TagName))
	ui.DimText("Run `raptix update` to upgrade.")
	return true
}

// ApplyUpdate syncs config and pulls images before replacing the binary or writing the version.
// The ref is the release tag or an explicit branch override.
func ApplyUpdate(release *Release, ref string) error {
	if release == nil {
		return fmt.Errorf("nil release")
	}

	ui.Info("Syncing configuration files...")
	// Branch configs cannot be checked against the release manifest.
	syncRelease := release
	if ref != release.TagName && ref != strings.TrimPrefix(release.TagName, "v") {
		syncRelease = nil
	}
	if err := SyncConfigFiles(ref, syncRelease); err != nil {
		return fmt.Errorf("config sync: %w", err)
	}

	c := compose.New()
	targetVersion := strings.TrimPrefix(release.TagName, "v")
	ui.Info("Pulling Docker images (" + targetVersion + ")...")
	if err := c.Pull(targetVersion); err != nil {
		return fmt.Errorf("image pull: %w", err)
	}

	if err := SelfUpdate(release); err != nil {
		return fmt.Errorf("binary update: %w", err)
	}
	if err := WriteVersion(release.TagName); err != nil {
		return fmt.Errorf("write version stamp: %w", err)
	}
	return nil
}

// PromptIfUpdateAvailable asks before updating and restarting. Without a TTY it prints a notice.
// Development builds, failed release checks and current versions skip the update.
func PromptIfUpdateAvailable(currentVersion string, ch Channel) (bool, error) {
	if currentVersion == "" || currentVersion == "dev" {
		return false, nil
	}
	if !isInteractiveStdin() {
		NotifyIfUpdateAvailable(currentVersion, ch)
		return false, nil
	}

	release, err := FetchRelease(ch)
	if err != nil {
		return false, nil // Silent skip — startup must not depend on GitHub.
	}
	if !CompareVersions(currentVersion, release.TagName) {
		return false, nil
	}

	ui.Info(fmt.Sprintf(
		"Update available: %s → %s",
		displayVersion(currentVersion),
		release.TagName,
	))

	var confirmed bool
	if err := huh.NewConfirm().
		Title(fmt.Sprintf("Install %s now?", release.TagName)).
		Description(
			"Updates the launcher binary, docker-compose config, and pulls\n" +
				"the matching Docker images. Raptix will restart with\n" +
				"the new version once the update finishes.",
		).
		Affirmative("Yes, update").
		Negative("Skip").
		Value(&confirmed).
		Run(); err != nil {
		// Prompt failure (e.g. tty closed mid-render) — fall through to
		// the passive notice rather than crashing the launch.
		ui.Warning("Update prompt failed: " + err.Error())
		return false, nil
	}
	if !confirmed {
		ui.DimText(
			"Continuing with " + displayVersion(currentVersion) +
				". Run `raptix update` later to upgrade.",
		)
		return false, nil
	}

	return applyAndReexec(release, currentVersion)
}

func isInteractiveStdin() bool {
	return term.IsTerminal(int(os.Stdin.Fd()))
}

func displayVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" || version == "dev" || strings.HasPrefix(version, "v") {
		return version
	}
	return "v" + version
}

// resolveUpdateRef picks the git ref for SyncConfigFiles: an explicit
// RAPTIX_BRANCH override in .env, otherwise the release tag.
func resolveUpdateRef(release *Release) string {
	ref := release.TagName
	if config.EnvExists() {
		if env, lerr := config.LoadEnv(config.EnvPath()); lerr == nil {
			if branch := strings.TrimSpace(env["RAPTIX_BRANCH"]); branch != "" {
				ref = branch
			}
		}
	}
	return ref
}

// applyAndReexec restarts the launcher only after the update succeeds.
func applyAndReexec(release *Release, currentVersion string) (bool, error) {
	if err := ApplyUpdate(release, resolveUpdateRef(release)); err != nil {
		ui.Warning("Update failed: " + err.Error())
		ui.DimText("Continuing with " + displayVersion(currentVersion) + ".")
		return false, nil
	}
	ui.Success("Update complete — restarting with " + release.TagName + "...")
	if err := reexecSelf(); err != nil {
		// Re-exec failed: tell the user to restart manually rather than
		// silently keep running the old in-memory image.
		ui.Warning("Re-exec failed: " + err.Error())
		ui.DimText("Run `raptix` again to use the new version.")
		os.Exit(0)
	}
	// A successful restart does not return on either platform.
	return true, nil
}

// AutoUpdateIfAvailable updates without prompting and skips dev builds, failed checks and current versions.
func AutoUpdateIfAvailable(currentVersion string, ch Channel) (bool, error) {
	if currentVersion == "" || currentVersion == "dev" {
		return false, nil
	}
	release, err := FetchRelease(ch)
	if err != nil {
		return false, nil // offline / GitHub down — never block launch
	}
	if !CompareVersions(currentVersion, release.TagName) {
		return false, nil
	}
	ui.Info(fmt.Sprintf(
		"Auto-updating: %s → %s (set AUTO_UPDATE=false to disable)",
		displayVersion(currentVersion),
		release.TagName,
	))
	return applyAndReexec(release, currentVersion)
}

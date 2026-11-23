package cmd

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"charm.land/huh/v2"
	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
	"github.com/spf13/cobra"
)

var (
	removeYes bool
)

var removeCmd = &cobra.Command{
	Use:     "remove",
	Aliases: []string{"uninstall"},
	Short:   "Uninstall Raptix completely",
	RunE:    runRemove,
}

func init() {
	removeCmd.Flags().BoolVar(&removeYes, "yes", false, "Skip confirmation prompts")
	rootCmd.AddCommand(removeCmd)
}

func runRemove(cmd *cobra.Command, args []string) error {
	if !removeYes {
		var confirm bool
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Title("Remove Raptix?").
					Description("This will stop all services, remove Docker images, and delete configuration.").
					Affirmative("Yes, remove").
					Negative("Cancel").
					Value(&confirm),
			),
		)
		if err := form.Run(); err != nil || !confirm {
			ui.Info("Removal cancelled")
			return nil
		}
	}

	home := config.RaptixHome()
	c := compose.New()

	// Purge named volumes as part of a full uninstall.
	ui.Info("Stopping services and removing volumes...")
	_ = c.DownAndPurge()

	ui.Info("Removing Docker images...")
	out, err := exec.Command("docker", "images", "--format", "{{.Repository}}:{{.Tag}}", "--filter", "reference=*raptix*").Output()
	if err == nil {
		for _, img := range strings.Fields(strings.TrimSpace(string(out))) {
			_ = exec.Command("docker", "rmi", "-f", img).Run()
		}
	}

	var preserveWorkspace bool
	if !removeYes {
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Title("Preserve workspace data?").
					Description(filepath.Join(home, "workspace")).
					Affirmative("Yes, keep my data").
					Negative("No, delete everything").
					Value(&preserveWorkspace),
			),
		)
		_ = form.Run()
	}

	userHome, _ := os.UserHomeDir()
	backupDir := filepath.Join(userHome, "raptix-workspace-backup")

	skipHomeRemoval := false
	if preserveWorkspace {
		wsDir := filepath.Join(home, "workspace")
		ui.Info("Backing up workspace to " + backupDir)
		if err := backupWorkspace(wsDir, backupDir); err != nil {
			ui.Warning("Backup failed: " + err.Error())
			ui.Warning("Workspace data left in place at " + wsDir)
			ui.DimText("Re-run 'raptix remove' or move the workspace manually before deleting " + home)
			skipHomeRemoval = true
		}
	}

	if !skipHomeRemoval {
		ui.Info("Removing " + home + "...")
		if err := os.RemoveAll(home); err != nil {
			ui.Error("Failed to remove " + home + ": " + err.Error())
			ui.DimText("Run manually: sudo rm -rf " + home)
		}
	}

	execPath, _ := os.Executable()
	ui.Info("Removing launcher binary...")
	_ = os.Remove(execPath)

	cleanShellRC()

	ui.Success("Raptix has been removed")
	if preserveWorkspace {
		ui.DimText("Workspace data preserved at " + backupDir)
	}
	return nil
}

// cleanShellRC removes PATH additions from shell config files.
func cleanShellRC() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	rcFiles := []string{
		filepath.Join(home, ".bashrc"),
		filepath.Join(home, ".profile"),
		filepath.Join(home, ".zshrc"),
		filepath.Join(home, ".config", "fish", "config.fish"),
	}

	for _, rc := range rcFiles {
		cleanPathFromFile(rc)
	}
}

// cleanPathFromFile removes the installer's marked PATH block and preserves other entries.
func cleanPathFromFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	f.Close()

	out := make([]string, 0, len(lines))
	changed := false
	i := 0
	for i < len(lines) {
		line := lines[i]
		if strings.TrimSpace(line) == "# raptix" && i+1 < len(lines) && isInstallPathLine(lines[i+1]) {
			// Drop a preceding blank line left by the legacy installer.
			if n := len(out); n > 0 && strings.TrimSpace(out[n-1]) == "" {
				out = out[:n-1]
			}
			i += 2
			changed = true
			continue
		}
		out = append(out, line)
		i++
	}

	if changed {
		_ = os.WriteFile(path, []byte(strings.Join(out, "\n")+"\n"), 0o644)
	}
}

// isInstallPathLine matches PATH entries written by the legacy installer.
func isInstallPathLine(line string) bool {
	s := strings.TrimSpace(line)
	if !strings.Contains(s, ".local/bin") {
		return false
	}
	return strings.HasPrefix(s, "export PATH=") || strings.HasPrefix(s, "fish_add_path ")
}

// backupWorkspace moves the workspace without replacing an existing backup.
// It falls back to copying when renaming fails.
func backupWorkspace(src, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("backup target already exists: %s", dst)
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// Cross-device or other rename failure: copy then remove.
	var err error
	if runtime.GOOS == "windows" {
		err = copyDirRecursive(src, dst)
	} else {
		_, err = exec.Command("cp", "-r", src, dst).CombinedOutput()
	}
	if err != nil {
		return fmt.Errorf("copy %s → %s: %w", src, dst, err)
	}
	return os.RemoveAll(src)

}

func copyDirRecursive(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}

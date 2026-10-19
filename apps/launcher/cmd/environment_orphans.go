package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/Akapi895/raptix/apps/launcher/internal/environments"
	"github.com/spf13/cobra"
)

// environment-orphans prints the containers of one deployment whose environment is not in the known list. It runs on
// the host, reads docker only, and changes nothing. The known list is exported from the control plane's database.
var environmentOrphansFlags struct {
	deployment string
	knownFile  string
}

var environmentOrphansCmd = &cobra.Command{
	Use:   "environment-orphans",
	Short: "Report containers of a deployment whose environment is unknown (read-only, ADR-0092 I06)",
	Long: "Lists the containers the environment controller created for one deployment and prints, as JSON, those " +
		"whose environment id is not in --known-file. The file holds one environment id per line. Nothing is removed.",
	RunE: runEnvironmentOrphans,
}

func init() {
	f := environmentOrphansCmd.Flags()
	f.StringVar(&environmentOrphansFlags.deployment, "deployment", "", "deployment id the containers were created for")
	f.StringVar(&environmentOrphansFlags.knownFile, "known-file", "", "file of environment ids the control plane still knows, one per line")
	_ = environmentOrphansCmd.MarkFlagRequired("deployment")
	rootCmd.AddCommand(environmentOrphansCmd)
}

func runEnvironmentOrphans(cmd *cobra.Command, _ []string) error {
	known, err := readKnownEnvironments(environmentOrphansFlags.knownFile)
	if err != nil {
		return err
	}
	orphans, err := environments.FindOrphans(cmd.Context(), environments.ExecRunner{}, environmentOrphansFlags.deployment, known)
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(orphans, "", "  ")
	if err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(encoded))
	return nil
}

func readKnownEnvironments(path string) (map[string]bool, error) {
	known := map[string]bool{}
	if path == "" {
		return known, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open known environments file: %w", err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if id := strings.TrimSpace(scanner.Text()); id != "" {
			known[id] = true
		}
	}
	return known, scanner.Err()
}

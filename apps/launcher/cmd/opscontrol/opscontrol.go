// Package opscontrol wires the host daemon into the launcher CLI.
package opscontrol

import "github.com/spf13/cobra"

// Cmd is the root of the opscontrol command tree. The launcher's
// `cmd/root.go` adds it to rootCmd in its init.
var Cmd = &cobra.Command{
	Use:   "opscontrol",
	Short: "Manage the agent-driven workload lifecycle daemon (ADR-0006)",
	Long: `opscontrol owns the docker socket on behalf of the agent so the
orchestrator can spawn domain-specific workloads (BHCE for AD,
Sliver C2 for post-exploit, etc.) at runtime rather than booting
the entire stack up front.

The daemon HTTP API is reachable only over a Unix domain socket
bind-mounted into the langgraph container. See
docs/security/sandbox-isolation.md.`,
}

func init() {
	Cmd.AddCommand(daemonCmd)
}

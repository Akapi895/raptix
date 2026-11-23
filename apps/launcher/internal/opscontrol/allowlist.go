package opscontrol

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

// DefaultAllowlist is the built-in workload catalog. Add new entries alongside their Compose profiles.
var DefaultAllowlist = []string{
	"ad",
	"c2-sliver",
	"c2-havoc",
	"reversing",
	"phishing",
	"mobile",
	"wireless",
	"cloud",
	"iot",
	"ics",
	"forensics",
	"supply-chain",
}

// AllowlistExtraEnv can add names to the catalog. It cannot remove built-in entries.
const AllowlistExtraEnv = "RAPTIX_OPS_ALLOWLIST_EXTRA"

// workloadName accepts lowercase letters, digits and dashes, up to 63 characters.
var workloadName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// Allowlist is the resolved permission set used by the daemon.
type Allowlist struct {
	members map[string]struct{}
}

// LoadAllowlist adds environment overrides and rejects invalid names.
func LoadAllowlist() (*Allowlist, error) {
	members := make(map[string]struct{}, len(DefaultAllowlist))
	for _, name := range DefaultAllowlist {
		members[name] = struct{}{}
	}
	if extra := os.Getenv(AllowlistExtraEnv); extra != "" {
		for _, name := range strings.Split(extra, ",") {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if !workloadName.MatchString(name) {
				return nil, fmt.Errorf("%s: invalid workload name %q", AllowlistExtraEnv, name)
			}
			members[name] = struct{}{}
		}
	}
	return &Allowlist{members: members}, nil
}

// Permits reports whether name is a valid workload AND is in the
// resolved allowlist. Used by the server before any docker shell-out.
func (a *Allowlist) Permits(name string) bool {
	if !workloadName.MatchString(name) {
		return false
	}
	_, ok := a.members[name]
	return ok
}

// Members returns the resolved allowlist sorted for stable health /
// status responses.
func (a *Allowlist) Members() []string {
	out := make([]string, 0, len(a.members))
	for name := range a.members {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

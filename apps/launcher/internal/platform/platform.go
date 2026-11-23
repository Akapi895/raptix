// Package platform detects the host environment for the launcher.
package platform

import (
	"os"
	"runtime"
	"strings"
)

// procVersionPath reads kernel text that identifies WSL.
var procVersionPath = "/proc/version"

// resolvConfPath locates the default WSL2 DNS forwarder configuration.
var resolvConfPath = "/etc/resolv.conf"

// IsWSL checks the Linux kernel version for WSL markers.
func IsWSL() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	data, err := os.ReadFile(procVersionPath)
	if err != nil {
		return false
	}
	s := strings.ToLower(string(data))
	return strings.Contains(s, "microsoft") || strings.Contains(s, "wsl")
}

// WSLHostIP assumes the first nameserver is the Windows host under default WSL2 NAT.
// It returns an empty string if the address is unavailable.
func WSLHostIP() string {
	data, err := os.ReadFile(resolvConfPath)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "nameserver" {
			return fields[1]
		}
	}
	return ""
}

package environments

import "testing"

// The messages below are what the Docker daemon actually returned during the live run, not the test doubles' wording.
func TestIsNotFoundRecognisesEveryDaemonWordingAndNothingElse(t *testing.T) {
	absent := []string{
		"Error response from daemon: No such container: raptix-env-4ae9bd6e3459-runtime",
		"Error response from daemon: network raptix-env-4ae9bd6e3459-net not found",
		"Error response from daemon: No such volume: raptix-env-4ae9bd6e3459-state",
		"Error response from daemon: get raptix-env-4ae9bd6e3459-state: no such volume",
	}
	for _, stderr := range absent {
		if !isNotFound(stderr) {
			t.Fatalf("isNotFound(%q) = false, want true", stderr)
		}
	}
	notAbsent := []string{
		"Error response from daemon: permission denied while trying to connect to the Docker daemon socket",
		"exec: \"docker\": executable file not found in $PATH",
		"",
	}
	for _, stderr := range notAbsent {
		if isNotFound(stderr) {
			t.Fatalf("isNotFound(%q) = true, want false", stderr)
		}
	}
}

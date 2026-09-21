package main

import (
	"strings"
	"testing"
	"time"
)

func TestRunRejectsUnknownCommandBeforeDatabase(t *testing.T) {
	err := run([]string{"-command", "invalid"})
	if err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("run error = %v, want unknown command", err)
	}
}

func TestRunRejectsUnexpectedArgumentsBeforeDatabase(t *testing.T) {
	err := run([]string{"unexpected"})
	if err == nil || !strings.Contains(err.Error(), "unexpected positional") {
		t.Fatalf("run error = %v, want positional argument error", err)
	}
}

func TestTimeoutSecondsRoundsUp(t *testing.T) {
	if got := timeoutSeconds(1500 * time.Millisecond); got != 2 {
		t.Errorf("timeoutSeconds(1.5s) = %d, want 2", got)
	}
}

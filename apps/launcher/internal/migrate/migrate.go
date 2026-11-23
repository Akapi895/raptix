// Package migrate applies upgrade steps during startup. Config backfills run every time.
// Interactive steps wait for a TTY and are recorded after success.
package migrate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/term"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
)

// ackFileName is the JSON record of interactive migrations the user has
// already been through, stored inside RAPTIX_HOME.
const ackFileName = ".migrations.json"

// Ctx is the shared state threaded through every step.
type Ctx struct {
	EnvPath string
	Env     map[string]string // current .env, mutated as steps write
	Home    string
	IsTTY   bool

	ackPath string
	acks    map[string]string
}

// Step is one upgrade applied at start. See the package doc for the
// interactive vs non-interactive contract.
type Step struct {
	ID          string
	Description string
	Interactive bool
	// Apply returns an optional operator message. A successful interactive step is recorded.
	Apply func(c *Ctx) (note string, err error)
}

// Indirections so tests can drive the framework without a real TTY or
// Huh prompt.
var (
	isInteractive = func() bool { return term.IsTerminal(int(os.Stdin.Fd())) }
)

// RunAll applies registered migrations to the loaded environment, which steps may update in place.
func RunAll(env map[string]string) {
	home := config.RaptixHome()
	c := &Ctx{
		EnvPath: config.EnvPath(),
		Env:     env,
		Home:    home,
		IsTTY:   isInteractive(),
		ackPath: filepath.Join(home, ackFileName),
	}
	c.loadAcks()
	Run(c, Registry())
}

// Run applies steps in order against c. Errors are surfaced as warnings
// and never abort the start flow.
func Run(c *Ctx, steps []Step) {
	for _, s := range steps {
		if s.Interactive {
			if c.Acked(s.ID) {
				continue
			}
			if !c.IsTTY {
				continue // defer to the next interactive start
			}
		}
		note, err := s.Apply(c)
		if err != nil {
			ui.Warning(fmt.Sprintf("migration %q: %v", s.ID, err))
			continue
		}
		if note != "" {
			ui.Info(note)
		}
		if s.Interactive {
			if ackErr := c.ack(s.ID); ackErr != nil {
				ui.Warning(fmt.Sprintf("could not record migration %q: %v", s.ID, ackErr))
			}
		}
	}
}

// MarkAcked records a choice made during onboarding so startup can skip that prompt.
func MarkAcked(home, id string) error {
	c := &Ctx{ackPath: filepath.Join(home, ackFileName)}
	c.loadAcks()
	return c.ack(id)
}

// Acked reports whether the interactive migration id has been recorded.
func (c *Ctx) Acked(id string) bool {
	_, ok := c.acks[id]
	return ok
}

func (c *Ctx) loadAcks() {
	c.acks = map[string]string{}
	data, err := os.ReadFile(c.ackPath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &c.acks)
}

func (c *Ctx) ack(id string) error {
	if c.acks == nil {
		c.acks = map[string]string{}
	}
	c.acks[id] = "acked"
	if err := os.MkdirAll(filepath.Dir(c.ackPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c.acks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.ackPath, data, 0o600)
}

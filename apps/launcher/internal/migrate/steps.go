package migrate

import (
	"fmt"
	"strings"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
)

// Registry is the ordered list of migrations applied at every start.
// Append a Step here to ship a future config/policy migration.
func Registry() []Step {
	return []Step{
		{
			ID:          "env-backfill",
			Description: "Backfill newly-added env.example keys into an existing .env",
			Interactive: false,
			Apply:       applyEnvBackfill,
		},
	}
}

func applyEnvBackfill(c *Ctx) (string, error) {
	added, err := config.BackfillEnvFromEmbed(c.EnvPath)
	if err != nil {
		return "", err
	}
	if len(added) == 0 {
		return "", nil
	}
	// Reflect the new keys into the in-memory env so the rest of `start`
	// sees them this run (without clobbering anything already loaded).
	if reloaded, lerr := config.LoadEnv(c.EnvPath); lerr == nil {
		for k, v := range reloaded {
			if _, ok := c.Env[k]; !ok {
				c.Env[k] = v
			}
		}
	}
	shown := added
	const cap = 8
	suffix := ""
	if len(added) > cap {
		shown = added[:cap]
		suffix = fmt.Sprintf(", +%d more", len(added)-cap)
	}
	return fmt.Sprintf(
		"Added %d new config key(s) to .env: %s%s (backup at %s.bak)",
		len(added), strings.Join(shown, ", "), suffix, c.EnvPath,
	), nil
}


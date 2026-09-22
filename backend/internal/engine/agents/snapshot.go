package agents

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
)

// resolveSnapshot records the profile, the requested capabilities and the
// granted capabilities at this point in time. The granted map is a record for
// audit; execution re-checks the grant at dispatch, so a later revocation or
// scope expiry still takes effect.
func (s *Service) resolveSnapshot(ctx context.Context, agent runs.AgentInstance, resolved *contextbuild.Resolved, scopeID uuid.UUID, actor string) (Snapshot, error) {
	requested := map[string]any{
		"tools":     resolved.Profile.Requested.Tools,
		"skills":    resolved.Profile.Requested.Skills,
		"resources": resolved.Profile.Requested.Resources,
	}
	granted := map[string]bool{}
	for _, tool := range resolved.Profile.Requested.Tools {
		ok, err := s.grants.CheckActiveGrant(ctx, actor, scopeID, tool)
		if err != nil {
			return Snapshot{}, fmt.Errorf("check grant for %s: %w", tool, err)
		}
		granted[tool] = ok
	}

	reqJSON, err := json.Marshal(requested)
	if err != nil {
		return Snapshot{}, fmt.Errorf("encode requested snapshot: %w", err)
	}
	grantJSON, err := json.Marshal(granted)
	if err != nil {
		return Snapshot{}, fmt.Errorf("encode granted snapshot: %w", err)
	}

	profileRef := resolved.Profile.Name
	if resolved.Profile.Version != "" {
		profileRef += "@" + resolved.Profile.Version
	}
	return s.repo.CreateSnapshot(ctx, CreateSnapshotParams{
		AgentID:     agent.ID,
		ProfileRef:  profileRef,
		ContentHash: resolved.ContentHash,
		Requested:   reqJSON,
		Granted:     grantJSON,
	})
}

// Package verifier performs active verification of a finding draft according to
// criteria. It reads the finding and its evidence, runs the required checks
// through execution (never a private execution path), and returns a verdict
// with new evidence references. It never changes a finding's status: findings is
// the sole owner of status transitions.
package verifier

import (
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

// Check is one verification step: re-run a capability and compare the observed
// execution status against what the criterion expects. ConfirmOn defaults to
// success. RefuteOn is optional; when it is empty a failed re-run is treated as
// inconclusive rather than refuted, because a failure may come from a changed
// environment, expired credentials or a missing precondition.
type Check struct {
	Capability string
	Args       json.RawMessage
	ConfirmOn  output.ExecutionStatus
	RefuteOn   output.ExecutionStatus
	Reason     string
}

// VerifyParams identifies the finding to verify and the checks to run.
type VerifyParams struct {
	FindingID uuid.UUID
	RunID     uuid.UUID
	ScopeID   uuid.UUID
	Actor     string
	Checks    []Check
}

// Result is the verifier's verdict for a finding.
type Result struct {
	Verdict     findings.Verdict
	Reason      string
	EvidenceIDs []uuid.UUID
}

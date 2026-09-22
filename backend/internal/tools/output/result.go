// Package output owns the serializable result envelope for tool invocations.
package output

import "fmt"

// ExecutionStatus records whether the capability was attempted and how it ended.
type ExecutionStatus string

const (
	ExecutionNotAttempted ExecutionStatus = "not_attempted"
	ExecutionSuccess      ExecutionStatus = "success"
	ExecutionFailed       ExecutionStatus = "failed"
	ExecutionTimedOut     ExecutionStatus = "timed_out"
	ExecutionCancelled    ExecutionStatus = "cancelled"
	ExecutionDenied       ExecutionStatus = "denied"
)

// ParseStatus records parser outcome independently from execution outcome.
type ParseStatus string

const (
	ParseNotAttempted ParseStatus = "not_attempted"
	ParseSuccess      ParseStatus = "success"
	ParsePartial      ParseStatus = "partial"
	ParseFailed       ParseStatus = "failed"
)

// ErrorDetail survives JSON serialization; Cause remains available locally for
// errors.Is/errors.As without becoming part of the persisted contract.
type ErrorDetail struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

type Diagnostic struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// Result references evidence-owned artifacts. A parse outcome never changes a
// finding verdict and a failed parse may still preserve RawRef.
type Result struct {
	Execution     ExecutionStatus `json:"execution"`
	Parse         ParseStatus     `json:"parse"`
	RawRef        string          `json:"rawRef,omitempty"`
	StructuredRef string          `json:"structuredRef,omitempty"`
	ParserVersion string          `json:"parserVersion,omitempty"`
	Diagnostics   []Diagnostic    `json:"diagnostics,omitempty"`
	Error         *ErrorDetail    `json:"error,omitempty"`
	ExitCode      *int            `json:"exitCode,omitempty"`
	DurationMs    int64           `json:"durationMs,omitempty"`
	Cause         error           `json:"-"`
}

func Success(rawRef, structuredRef, parserVersion string) *Result {
	r := &Result{Execution: ExecutionSuccess, Parse: ParseNotAttempted, RawRef: rawRef}
	if structuredRef != "" {
		r.StructuredRef, r.ParserVersion, r.Parse = structuredRef, parserVersion, ParseSuccess
	}
	return r
}

func Partial(rawRef, structuredRef, parserVersion string, diags []Diagnostic) *Result {
	return &Result{Execution: ExecutionSuccess, Parse: ParsePartial, RawRef: rawRef, StructuredRef: structuredRef, ParserVersion: parserVersion, Diagnostics: diags}
}

func ParseFailure(rawRef, parserVersion string, err error) *Result {
	return &Result{Execution: ExecutionSuccess, Parse: ParseFailed, RawRef: rawRef, ParserVersion: parserVersion, Error: errorDetail(err), Cause: err}
}

func Error(rawRef string, err error) *Result {
	return &Result{Execution: ExecutionFailed, Parse: ParseNotAttempted, RawRef: rawRef, Error: errorDetail(err), Cause: err}
}

func Timeout(rawRef string, err error) *Result {
	return &Result{Execution: ExecutionTimedOut, Parse: ParseNotAttempted, RawRef: rawRef, Error: errorDetail(err), Cause: err}
}

func Cancelled(rawRef string, err error) *Result {
	return &Result{Execution: ExecutionCancelled, Parse: ParseNotAttempted, RawRef: rawRef, Error: errorDetail(err), Cause: err}
}

// Denied reports that an invocation was not dispatched because of a permission,
// scope, state or budget check. The capability itself never ran.
func Denied(reason string) *Result {
	return &Result{Execution: ExecutionDenied, Parse: ParseNotAttempted, Error: &ErrorDetail{Code: "denied", Message: reason}}
}

func errorDetail(err error) *ErrorDetail {
	if err == nil {
		return nil
	}
	return &ErrorDetail{Code: "execution_error", Message: err.Error()}
}

// OK reports an execution success with a complete or partial parser result.
func (r *Result) OK() bool {
	return r != nil && r.Execution == ExecutionSuccess && (r.Parse == ParseSuccess || r.Parse == ParsePartial)
}

func (r *Result) AddDiagnostic(level, message string) {
	r.Diagnostics = append(r.Diagnostics, Diagnostic{Level: level, Message: message})
}

// Validate rejects contradictory artifact and parser combinations.
func (r *Result) Validate() error {
	if r == nil {
		return fmt.Errorf("result is nil")
	}
	if r.Execution == "" || r.Parse == "" {
		return fmt.Errorf("execution and parse statuses are required")
	}
	if r.StructuredRef != "" && (r.RawRef == "" || r.ParserVersion == "" || (r.Parse != ParseSuccess && r.Parse != ParsePartial)) {
		return fmt.Errorf("structured result requires raw ref, parser version, and successful or partial parse")
	}
	if r.Parse == ParseSuccess && r.StructuredRef == "" {
		return fmt.Errorf("successful parse requires structured ref")
	}
	if r.Parse == ParseFailed && r.ParserVersion == "" {
		return fmt.Errorf("failed parse requires parser version")
	}
	if r.Execution != ExecutionSuccess && r.Parse != ParseNotAttempted {
		return fmt.Errorf("non-successful execution cannot have parse outcome")
	}
	return nil
}

package opscontrol

import "context"

// WorkloadState is the backend-independent lifecycle state.
type WorkloadState string

const (
	StateRunning  WorkloadState = "running"
	StateStarting WorkloadState = "starting"
	StateStopping WorkloadState = "stopping"
	StateStopped  WorkloadState = "stopped"
	StateUnknown  WorkloadState = "unknown"
)

// Handle identifies a workload started by the backend.
type Handle struct {
	Workload     string        `json:"workload"`
	State        WorkloadState `json:"state"`
	EngagementID string        `json:"engagement_id,omitempty"`
}

// WorkloadStatus is one row of the Backend.List response.
type WorkloadStatus struct {
	Workload     string        `json:"workload"`
	State        WorkloadState `json:"state"`
	EngagementID string        `json:"engagement_id,omitempty"`
	Since        string        `json:"since,omitempty"`
}

// Backend manages workload lifecycle without exposing runtime details to HTTP clients.
type Backend interface {
	// Start returns the existing handle if the workload is already running.
	Start(ctx context.Context, workload string, engagementID string) (Handle, error)

	// Stop tears down the workload. Idempotent: stopping a stopped
	// workload returns nil.
	Stop(ctx context.Context, workload string) error

	// List returns the state of workloads known to this daemon session.
	List(ctx context.Context) ([]WorkloadStatus, error)

	// Name identifies the backend in /v1/health.
	Name() string
}

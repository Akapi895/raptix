package opscontrol

import (
	"sync"
	"time"
)

// registryEntry stores one workload's state for this daemon session.
type registryEntry struct {
	State        WorkloadState
	EngagementID string
	UpdatedAt    time.Time
}

// registry tracks workload state and serializes start and stop with per-workload locks.
type registry struct {
	mu      sync.Mutex
	entries map[string]*registryEntry
	locks   map[string]*sync.Mutex
}

func newRegistry() *registry {
	return &registry{
		entries: map[string]*registryEntry{},
		locks:   map[string]*sync.Mutex{},
	}
}

// lockFor returns the per-workload mutex, creating it on first
// reference. Callers must Lock/Unlock around their backend op.
func (r *registry) lockFor(workload string) *sync.Mutex {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.locks[workload]
	if !ok {
		m = &sync.Mutex{}
		r.locks[workload] = m
	}
	return m
}

func (r *registry) set(workload string, state WorkloadState, engagementID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[workload]
	if !ok {
		e = &registryEntry{}
		r.entries[workload] = e
	}
	e.State = state
	if engagementID != "" {
		e.EngagementID = engagementID
	}
	e.UpdatedAt = time.Now().UTC()
}

func (r *registry) get(workload string) (registryEntry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[workload]
	if !ok {
		return registryEntry{}, false
	}
	return *e, true
}

func (r *registry) snapshot() []WorkloadStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]WorkloadStatus, 0, len(r.entries))
	for workload, e := range r.entries {
		out = append(out, WorkloadStatus{
			Workload:     workload,
			State:        e.State,
			EngagementID: e.EngagementID,
			Since:        e.UpdatedAt.Format(time.RFC3339),
		})
	}
	return out
}

// workloadsForEngagement lists active workloads. The caller locks each workload before stopping it.
func (r *registry) workloadsForEngagement(engagementID string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []string{}
	for workload, e := range r.entries {
		if e.EngagementID == engagementID && e.State != StateStopped {
			out = append(out, workload)
		}
	}
	return out
}

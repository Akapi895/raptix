// Package registry maps tool IDs to their declared capabilities and any
// registered implementation. It answers "is a capability known and compatible"
// but holds no execution rights: a tool existing in the registry never grants
// permission to run it. Invocation is dispatched by execution (Phase 4).
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// Implementation executes a registered capability. Implementations are supplied
// by tools/builtin or command/mcp adapters; registry only holds them.
type Implementation interface {
	Invoke(ctx context.Context, args json.RawMessage) (*output.Result, error)
}

// Descriptor is the resolved declaration for one tool version. Registry methods
// return defensive copies, so consumers cannot alter a registered declaration.
// Bound and Ready describe registry state only; they never grant execution.
type Descriptor struct {
	ID       string
	Version  string
	Executor content.ExecutorType
	Source   string
	Input    interface{}
	Output   interface{}
	Runtime  RuntimeRequirements
	Declared bool
	Bound    bool
	Ready    bool
}

// RuntimeRequirements records the runtime constraints declared by a tool.
type RuntimeRequirements struct {
	Container bool
	Network   bool
	Resources map[string]interface{}
}

// entry describes one version of a tool: its executor kind, and an optional
// implementation. A declared entry with a nil implementation is discoverable
// (Compat) but not yet runnable (Available is false).
type entry struct {
	Descriptor Descriptor
	Impl       Implementation
}

// Registry is a concurrency-safe map of tool ids to versioned entries.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]map[string]entry
}

// New builds an empty registry.
func New() *Registry {
	return &Registry{tools: map[string]map[string]entry{}}
}

// Register declares a tool or binds its first implementation. A declared-only
// entry may be bound once later, but conflicting declarations and rebinding are
// rejected.
func (r *Registry) Register(id, version string, kind content.ExecutorType, impl Implementation, source string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("tool id must not be empty")
	}
	if version == "" {
		version = "1.0.0"
	}
	if !validExecutor(kind) {
		return fmt.Errorf("tool %s has unsupported executor %q", id, kind)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tools[id]; !ok {
		r.tools[id] = map[string]entry{}
	}
	if existing, ok := r.tools[id][version]; ok {
		if existing.Descriptor.Executor == kind && existing.Impl == nil && impl != nil {
			existing.Impl = impl
			existing.Descriptor.Bound = true
			existing.Descriptor.Ready = true
			r.tools[id][version] = existing
			return nil
		}
		return fmt.Errorf("tool %s version %s already registered", id, version)
	}
	r.tools[id][version] = entry{Descriptor: Descriptor{
		ID: id, Version: version, Executor: kind, Source: source,
		Declared: true, Bound: impl != nil, Ready: impl != nil,
	}, Impl: impl}
	return nil
}

func validExecutor(kind content.ExecutorType) bool {
	switch kind {
	case content.ExecutorBuiltin, content.ExecutorCommand, content.ExecutorMCP:
		return true
	default:
		return false
	}
}

// RegisterFromManifest registers a tool using its manifest metadata loaded from
// the content loader. The implementation is optional; pass nil to only declare
// the capability from the manifest.
func (r *Registry) RegisterFromManifest(l *content.Loader, name string, impl Implementation) error {
	t, err := l.LoadTool(name)
	if err != nil {
		return err
	}
	version := t.Version
	if version == "" {
		version = "1.0.0"
	}
	if err := r.Register(t.Name, version, t.Executor.Type, impl, t.Source.Repo+"/"+t.Source.Path); err != nil {
		return err
	}
	r.mu.Lock()
	e := r.tools[t.Name][version]
	e.Descriptor.Input = content.DeepClone(t.Input)
	e.Descriptor.Output = content.DeepClone(t.Output)
	e.Descriptor.Runtime = RuntimeRequirements{
		Container: t.Runtime.Container,
		Network:   t.Runtime.Network,
		Resources: cloneResources(t.Runtime.Resources),
	}
	r.tools[t.Name][version] = e
	r.mu.Unlock()
	return nil
}

// Get returns the implementation and resolved descriptor for a tool's latest
// version. It errors when the tool is unknown or has no implementation yet;
// the returned descriptor still identifies a declared-only entry.
func (r *Registry) Get(id string) (Implementation, Descriptor, error) {
	r.mu.RLock()
	e, ok := r.lookupLocked(id, "")
	r.mu.RUnlock()
	if !ok {
		return nil, Descriptor{}, fmt.Errorf("tool %s version not found", id)
	}
	if e.Impl == nil {
		return nil, cloneDescriptor(e.Descriptor), fmt.Errorf("tool %s version %s is declared but has no implementation", id, e.Descriptor.Version)
	}
	return e.Impl, cloneDescriptor(e.Descriptor), nil
}

// GetVersion returns the implementation and resolved descriptor for an exact
// tool version. It errors when the tool/version is unknown or has no implementation.
func (r *Registry) GetVersion(id, version string) (Implementation, Descriptor, error) {
	r.mu.RLock()
	e, ok := r.lookupLocked(id, version)
	r.mu.RUnlock()
	if !ok {
		return nil, Descriptor{}, fmt.Errorf("tool %s version %q not found", id, version)
	}
	if e.Impl == nil {
		return nil, cloneDescriptor(e.Descriptor), fmt.Errorf("tool %s version %s is declared but has no implementation", id, e.Descriptor.Version)
	}
	return e.Impl, cloneDescriptor(e.Descriptor), nil
}

// lookupLocked resolves an entry while the caller holds r.mu (read or write).
// An empty version resolves to the highest, per the chosen version policy.
func (r *Registry) lookupLocked(id, version string) (entry, bool) {
	versions, ok := r.tools[id]
	if !ok || len(versions) == 0 {
		return entry{}, false
	}
	if version == "" {
		version = latestKey(versions)
	}
	e, ok := versions[version]
	return e, ok
}

// Available reports whether a tool (latest version) has a runnable implementation.
func (r *Registry) Available(id string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.lookupLocked(id, "")
	return ok && e.Impl != nil
}

// Compat reports whether a tool's latest entry declares the given executor kind.
// A capability matching the environment is not a grant: execution still checks
// governance/scope at dispatch.
func (r *Registry) Compat(id string, kind content.ExecutorType) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.lookupLocked(id, "")
	return ok && e.Descriptor.Executor == kind
}

// Describe returns the resolved descriptor for a tool's latest version,
// including declared runtime and input/output metadata.
func (r *Registry) Describe(id string) (Descriptor, error) {
	r.mu.RLock()
	e, ok := r.lookupLocked(id, "")
	r.mu.RUnlock()
	if !ok {
		return Descriptor{}, fmt.Errorf("tool %s version not found", id)
	}
	return cloneDescriptor(e.Descriptor), nil
}

// DescribeVersion returns the resolved descriptor for an exact tool version.
func (r *Registry) DescribeVersion(id, version string) (Descriptor, error) {
	r.mu.RLock()
	e, ok := r.lookupLocked(id, version)
	r.mu.RUnlock()
	if !ok {
		return Descriptor{}, fmt.Errorf("tool %s version %q not found", id, version)
	}
	return cloneDescriptor(e.Descriptor), nil
}

// List returns defensive copies of the latest resolved tool descriptors.
func (r *Registry) List() map[string]Descriptor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]Descriptor, len(r.tools))
	for id, versions := range r.tools {
		if len(versions) == 0 {
			continue
		}
		out[id] = cloneDescriptor(versions[latestKey(versions)].Descriptor)
	}
	return out
}

// cloneDescriptor returns a defensive copy of a descriptor so callers cannot
// mutate registry-held documents through the returned value.
func cloneDescriptor(d Descriptor) Descriptor {
	d.Input = content.DeepClone(d.Input)
	d.Output = content.DeepClone(d.Output)
	d.Runtime.Resources = cloneResources(d.Runtime.Resources)
	return d
}

// cloneResources clones a runtime resource map, preserving a nil value.
func cloneResources(in map[string]interface{}) map[string]interface{} {
	if in == nil {
		return nil
	}
	return content.DeepClone(in).(map[string]interface{})
}

// latestKey returns the selected version key under the version policy
// (highest semver). The caller must hold r.mu.
func latestKey(versions map[string]entry) string {
	keys := make([]string, 0, len(versions))
	for k := range versions {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return compareVersions(keys[i], keys[j]) < 0 })
	return keys[len(keys)-1]
}

// compareVersions orders version strings. If both parse as semver (X.Y.Z),
// they are compared numerically; otherwise a stable string comparison is used.
func compareVersions(a, b string) int {
	av, aok := parseVersion(a)
	bv, bok := parseVersion(b)
	if aok && bok {
		for i := 0; i < 3; i++ {
			if av[i] != bv[i] {
				if av[i] < bv[i] {
					return -1
				}
				return 1
			}
		}
		return 0
	}
	switch {
	case a == b:
		return 0
	case a < b:
		return -1
	default:
		return 1
	}
}

// parseVersion splits a "major.minor.patch" version; missing parts default to 0.
func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := 0
	num := 0
	inNum := false
	valid := true
	flush := func() {
		if parts < 3 {
			out[parts] = num
			parts++
		}
		num = 0
		inNum = false
	}
	for _, r := range v {
		switch {
		case r >= '0' && r <= '9':
			num = num*10 + int(r-'0')
			inNum = true
		case r == '.':
			if !inNum {
				valid = false
				break
			}
			flush()
		default:
			// Not a strict semver: caller falls back to string ordering.
			return out, false
		}
	}
	if !inNum {
		valid = false
	}
	if valid {
		flush()
	}
	return out, valid && parts >= 1
}

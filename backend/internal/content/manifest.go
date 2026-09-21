package content

// Kind identifies the type of a content manifest.
type Kind string

const (
	KindProfile  Kind = "profile"
	KindSkill    Kind = "skill"
	KindTool     Kind = "tool"
	KindResource Kind = "resource"
	KindRuntime  Kind = "runtime"
)

// manifestBase carries fields shared by every manifest kind.
type manifestBase struct {
	APIVersion  string `yaml:"apiVersion" json:"apiVersion"`
	Kind        string `yaml:"kind" json:"kind"`
	Name        string `yaml:"name" json:"name"`
	Version     string `yaml:"version" json:"version,omitempty"`
	Description string `yaml:"description" json:"description,omitempty"`
	License     string `yaml:"license" json:"license,omitempty"`
}

// Profile describes an agent role: prompt refs, requested capabilities, model.
type Profile struct {
	manifestBase `yaml:",inline"`
	PromptRefs   []string `yaml:"promptRefs" json:"promptRefs,omitempty"`
	Requested    struct {
		Skills    []string `yaml:"skills" json:"skills,omitempty"`
		Tools     []string `yaml:"tools" json:"tools,omitempty"`
		Resources []string `yaml:"resources" json:"resources,omitempty"`
	} `yaml:"requested" json:"requested"`
	Model string `yaml:"model" json:"model,omitempty"`
}

// Skill bundles task guidance, stored as <name>/SKILL.md with optional YAML
// frontmatter (name/description) followed by the markdown body. Loaded only
// when selected into agent context; selecting a skill never grants execution.
type Skill struct {
	manifestBase `yaml:",inline"`
	Metadata     map[string]interface{} `yaml:"metadata" json:"metadata,omitempty"`
	Body         string                 `yaml:"-" json:"-"`
}

// Identity identifies a declared item in the content catalog.
type Identity struct {
	Kind Kind
	Name string
}

// ResolvedContent records the immutable provenance of content selected from a
// catalog. Path is slash-separated and relative to the content root; Hash is
// the SHA-256 digest of the source file, prefixed with "sha256:".
type ResolvedContent struct {
	Identity Identity
	Version  string
	Hash     string
	Path     string
}

// SkillMetadata is the metadata-first representation of a skill. It excludes
// the markdown body so callers can discover or snapshot a skill before adding
// its guidance to an agent context.
type SkillMetadata struct {
	ResolvedContent
	Description string
	License     string
	Metadata    map[string]interface{}
}

// ExecutorType is the kind of capability implementation.
type ExecutorType string

const (
	ExecutorBuiltin ExecutorType = "builtin"
	ExecutorCommand ExecutorType = "command"
	ExecutorMCP     ExecutorType = "mcp"
)

// Executor describes how a tool is invoked.
type Executor struct {
	Type    ExecutorType `yaml:"type" json:"type"`
	Command string       `yaml:"command" json:"command,omitempty"`
	Args    []string     `yaml:"args" json:"args,omitempty"`
	Runtime string       `yaml:"runtime" json:"runtime,omitempty"`
}

// Tool describes a capability in the catalog.
type Tool struct {
	manifestBase `yaml:",inline"`
	Executor     Executor `yaml:"executor" json:"executor"`
	Runtime      struct {
		Container bool                   `yaml:"container" json:"container"`
		Network   bool                   `yaml:"network" json:"network"`
		Resources map[string]interface{} `yaml:"resources" json:"resources,omitempty"`
	} `yaml:"runtime" json:"runtime"`
	Input  interface{} `yaml:"input" json:"input,omitempty"`
	Output interface{} `yaml:"output" json:"output,omitempty"`
	Source struct {
		Repo   string `yaml:"repo" json:"repo,omitempty"`
		Path   string `yaml:"path" json:"path,omitempty"`
		Commit string `yaml:"commit" json:"commit,omitempty"`
	} `yaml:"source" json:"source"`
}

// Resource references external material with provenance.
type Resource struct {
	manifestBase `yaml:",inline"`
	Source       struct {
		URL    string `yaml:"url" json:"url,omitempty"`
		Repo   string `yaml:"repo" json:"repo,omitempty"`
		Commit string `yaml:"commit" json:"commit,omitempty"`
	} `yaml:"source" json:"source"`
	Digest    string `yaml:"digest" json:"digest,omitempty"`
	Size      int64  `yaml:"size" json:"size,omitempty"`
	Format    string `yaml:"format" json:"format,omitempty"`
	Reference string `yaml:"reference" json:"reference,omitempty"`
}

// Runtime declares the environment inventory for sandboxed capabilities.
type Runtime struct {
	manifestBase `yaml:",inline"`
	Image        string                 `yaml:"image" json:"image,omitempty"`
	Capabilities []string               `yaml:"capabilities" json:"capabilities,omitempty"`
	Inventory    map[string]interface{} `yaml:"inventory" json:"inventory,omitempty"`
}

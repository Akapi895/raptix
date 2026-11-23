package config

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed env.example
var EnvTemplate string

const (
	DefaultHome       = ".raptix"
	EnvFileName       = ".env"
	EnvExampleName    = ".env.example"
	PlaceholderSuffix = "-key-here"
)

// Config holds the Raptix launcher configuration.
type Config struct {
	Home string
	Env  map[string]string
}

// RaptixHome returns the resolved RAPTIX_HOME path.
func RaptixHome() string {
	if h := os.Getenv("RAPTIX_HOME"); h != "" {
		return h
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join("~", DefaultHome)
	}
	return filepath.Join(home, DefaultHome)
}

// EnvPath returns the full path to the .env file.
func EnvPath() string {
	return filepath.Join(RaptixHome(), EnvFileName)
}

// EnvExists checks whether .env exists.
func EnvExists() bool {
	_, err := os.Stat(EnvPath())
	return err == nil
}

// LoadEnv reads a .env file and returns key-value pairs.
// It handles comments (#), empty lines, and optional quoting.
func LoadEnv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open env file: %w", err)
	}
	defer f.Close()

	env := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := parseEnvLine(line)
		if !ok {
			continue
		}
		env[key] = val
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read env file: %w", err)
	}
	return env, nil
}

// parseEnvLine splits "KEY=VALUE" handling optional quotes.
func parseEnvLine(line string) (key, val string, ok bool) {
	idx := strings.IndexByte(line, '=')
	if idx < 1 {
		return "", "", false
	}
	key = strings.TrimSpace(line[:idx])
	val = strings.TrimSpace(line[idx+1:])
	// Strip surrounding quotes
	if len(val) >= 2 {
		if (val[0] == '"' && val[len(val)-1] == '"') ||
			(val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		}
	}
	return key, val, true
}

// WriteEnvFromEmbed writes key-value pairs into a .env file using the embedded template.
func WriteEnvFromEmbed(outputPath string, values map[string]string) error {
	return writeEnvFromString(EnvTemplate, outputPath, values)
}

// WriteEnv writes key-value pairs into a .env file using a template file.
func WriteEnv(templatePath, outputPath string, values map[string]string) error {
	tmpl, err := os.ReadFile(templatePath)
	if err != nil {
		return fmt.Errorf("read template: %w", err)
	}
	return writeEnvFromString(string(tmpl), outputPath, values)
}

func writeEnvFromString(tmpl string, outputPath string, values map[string]string) error {
	lines := strings.Split(tmpl, "\n")
	consumed := make(map[string]bool) // track which values were written
	var out []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			out = append(out, line)
			continue
		}
		// Try to match commented-out env lines: "# KEY=value" or "#KEY=value"
		if strings.HasPrefix(trimmed, "#") {
			uncommented := strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
			key, _, ok := parseEnvLine(uncommented)
			if ok {
				if newVal, exists := values[key]; exists {
					out = append(out, key+"="+newVal)
					consumed[key] = true
					continue
				}
			}
			// Plain comment or no matching value — keep as-is
			out = append(out, line)
			continue
		}
		key, _, ok := parseEnvLine(trimmed)
		if !ok {
			out = append(out, line)
			continue
		}
		if newVal, exists := values[key]; exists {
			out = append(out, key+"="+newVal)
			consumed[key] = true
		} else {
			out = append(out, line)
		}
	}
	// Append any values that didn't match a template line (e.g. AWS_REGION_NAME)
	for key, val := range values {
		if !consumed[key] {
			out = append(out, key+"="+val)
		}
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}
	return writePrivateFile(outputPath, []byte(strings.Join(out, "\n")))
}

// writePrivateFile atomically replaces the destination with a private file.
// Writing over an existing file with os.WriteFile would keep its old permissions.
func writePrivateFile(path string, data []byte) (retErr error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".env.tmp-*")
	if err != nil {
		return fmt.Errorf("create temporary env: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if retErr != nil {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return fmt.Errorf("secure temporary env: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fmt.Errorf("write temporary env: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary env: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace env: %w", err)
	}
	return nil
}

// APIKeyNames lists provider keys accepted by the startup credential check.
// Keep the list aligned with keyFormatRules and the runtime's _API_METHOD_ENV.
var APIKeyNames = []string{
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"MINIMAX_API_KEY",
	"OPENROUTER_API_KEY",
	"NVIDIA_API_KEY",
	"DEEPSEEK_API_KEY",
	"XAI_API_KEY",
	"MISTRAL_API_KEY",
	// Cloud gateways added in the OpenClaude provider migration.
	"GROQ_API_KEY",
	"TOGETHER_API_KEY",
	"FIREWORKS_API_KEY",
	"COHERE_API_KEY",
	"MOONSHOT_API_KEY",
	"KIMI_API_KEY",
	"ZAI_API_KEY",
	"DASHSCOPE_API_KEY",
	"GITHUB_TOKEN",
	// AWS Bedrock — IAM access key. Validation accepts the AKIA prefix.
	"AWS_ACCESS_KEY_ID",
	// Azure OpenAI deployment key.
	"AZURE_API_KEY",
	// Vertex AI uses a service-account JSON path. Treated as the
	// credential signal so an empty path doesn't pass startup gating.
	"GOOGLE_APPLICATION_CREDENTIALS",
	// Custom OpenAI-compatible endpoint key — paired with a base URL,
	// no fixed shape.
	"CUSTOM_OPENAI_API_KEY",
}

// IsPlaceholder checks if a value looks like a placeholder.
func IsPlaceholder(val string) bool {
	return strings.HasSuffix(val, PlaceholderSuffix) || val == ""
}

// keyFormatRules rejects obvious typos. Providers without a stable prefix get only a length check.
var keyFormatRules = map[string]struct {
	Prefix string
	Hint   string
}{
	"ANTHROPIC_API_KEY":  {Prefix: "sk-", Hint: "Anthropic keys start with 'sk-'"},
	"OPENAI_API_KEY":     {Prefix: "sk-", Hint: "OpenAI keys start with 'sk-'"},
	"GEMINI_API_KEY":     {Prefix: "AIza", Hint: "Gemini keys start with 'AIza'"},
	"OPENROUTER_API_KEY": {Prefix: "sk-or-", Hint: "OpenRouter keys start with 'sk-or-'"},
	"NVIDIA_API_KEY":     {Prefix: "nvapi-", Hint: "NVIDIA keys start with 'nvapi-'"},
	"DEEPSEEK_API_KEY":   {Prefix: "sk-", Hint: "DeepSeek keys start with 'sk-'"},
	"XAI_API_KEY":        {Prefix: "xai-", Hint: "xAI keys start with 'xai-'"},
	"MINIMAX_API_KEY":    {Prefix: "", Hint: ""},
	"MISTRAL_API_KEY":    {Prefix: "", Hint: ""},
	"GROQ_API_KEY":       {Prefix: "gsk_", Hint: "Groq keys start with 'gsk_'"},
	"TOGETHER_API_KEY":   {Prefix: "", Hint: ""},
	"FIREWORKS_API_KEY":  {Prefix: "fw_", Hint: "Fireworks keys start with 'fw_'"},
	"COHERE_API_KEY":     {Prefix: "", Hint: ""},
	"MOONSHOT_API_KEY":   {Prefix: "sk-", Hint: "Moonshot keys start with 'sk-'"},
	"KIMI_API_KEY":       {Prefix: "sk-kimi-", Hint: "Kimi for Coding keys start with 'sk-kimi-'"},
	"ZAI_API_KEY":        {Prefix: "", Hint: ""},
	"DASHSCOPE_API_KEY":  {Prefix: "sk-", Hint: "DashScope keys start with 'sk-'"},
	// GitHub fine-grained PATs start with github_pat_; classic PATs
	// start with ghp_. Accept either by skipping the prefix check.
	"GITHUB_TOKEN":                   {Prefix: "", Hint: ""},
	"AWS_ACCESS_KEY_ID":              {Prefix: "AKIA", Hint: "AWS access key IDs start with 'AKIA'"},
	"AZURE_API_KEY":                  {Prefix: "", Hint: ""},
	"GOOGLE_APPLICATION_CREDENTIALS": {Prefix: "", Hint: "must be an absolute path to a service-account JSON file"},

	"CUSTOM_OPENAI_API_KEY": {Prefix: "", Hint: ""},
}

// validateKeyFormat returns an empty string if the key looks valid, or a reason if not.
func validateKeyFormat(name, val string) string {
	// File-path keys have different validation
	if name == "GOOGLE_APPLICATION_CREDENTIALS" {
		if _, err := os.Stat(val); err != nil {
			return "file not found: " + val
		}
		return ""
	}
	if len(val) < 20 {
		return "value is too short to be a valid API key"
	}
	if rule, ok := keyFormatRules[name]; ok {
		// Empty Prefix → provider has no fixed prefix, length floor is the
		// only signal. Skip the prefix check rather than rejecting valid keys.
		if rule.Prefix != "" && !strings.HasPrefix(val, rule.Prefix) {
			return rule.Hint
		}
	}
	return ""
}

// ValidateAPIKeys checks that at least one API key is set with a valid format.
// Returns a fatal error listing both unset keys and any format problems found.
func ValidateAPIKeys(env map[string]string) error {
	var validNames []string
	invalidReasons := make(map[string]string)

	for _, name := range APIKeyNames {
		val := env[name]
		if val == "" || IsPlaceholder(val) {
			continue
		}
		if reason := validateKeyFormat(name, val); reason != "" {
			invalidReasons[name] = reason
			continue
		}
		validNames = append(validNames, name)
	}

	if len(validNames) > 0 {
		return nil
	}

	var msg strings.Builder
	msg.WriteString("no valid API key found.")
	if len(invalidReasons) > 0 {
		msg.WriteString(" Detected malformed key(s):")
		for name, reason := range invalidReasons {
			msg.WriteString(fmt.Sprintf("\n  %s: %s", name, reason))
		}
	}
	msg.WriteString("\nRun 'raptix onboard --reset' to reconfigure credentials.")
	return fmt.Errorf("%s", msg.String())
}

// ValidateAuth accepts any valid subscription credential, local model configuration or provider key.
// If all checks fail, report the error for the explicitly selected OAuth method first.
func ValidateAuth(env map[string]string) error {
	claudeOAuth := isTruthy(Get(env, "RAPTIX_AUTH_CLAUDE_CODE", ""))
	chatGPTOAuth := isTruthy(Get(env, "RAPTIX_AUTH_CHATGPT", ""))
	ollamaErr := validateOllamaCredentials(env)
	apiErr := ValidateAPIKeys(env)

	if claudeOAuth {
		if err := validateClaudeCredentials(); err == nil {
			return nil
		}
	}
	var chatGPTErr error
	if chatGPTOAuth {
		// ChatGPT accepts interactive login when the host token file is absent.
		if _, chatGPTErr = os.UserHomeDir(); chatGPTErr == nil {
			return nil
		}
	}
	if ollamaErr == nil {
		return nil
	}
	if apiErr == nil {
		return nil
	}

	// All paths failed — surface the user's explicit choice first.
	if claudeOAuth {
		return validateClaudeCredentials()
	}
	if chatGPTErr != nil {
		return fmt.Errorf("locate home directory: %w", chatGPTErr)
	}
	if hasOllamaSelected(env) {
		return ollamaErr
	}
	return apiErr
}

// hasOllamaSelected checks explicit priority or an Ollama URL without another API key.
func hasOllamaSelected(env map[string]string) bool {
	priority := strings.ToLower(strings.TrimSpace(env["RAPTIX_AUTH_PRIORITY"]))
	for _, m := range strings.Split(priority, ",") {
		if strings.TrimSpace(m) == "ollama_local" {
			return true
		}
	}
	return env["OLLAMA_API_BASE"] != ""
}

// validateOllamaCredentials checks configuration only. Reachability depends on container routing.
func validateOllamaCredentials(env map[string]string) error {
	if !hasOllamaSelected(env) {
		return fmt.Errorf("ollama not configured")
	}
	base := strings.TrimSpace(env["OLLAMA_API_BASE"])
	if base == "" {
		return fmt.Errorf(
			"ollama_local selected but OLLAMA_API_BASE is empty.\n" +
				"Set OLLAMA_API_BASE=http://host.docker.internal:11434 (or your Ollama URL) " +
				"in ~/.raptix/.env, or run 'raptix onboard --reset' to reconfigure.",
		)
	}
	return nil
}

func isTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "on":
		return true
	}
	return false
}

// validateClaudeCredentials checks that the mounted file contains a token accepted by LiteLLM.
func validateClaudeCredentials() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("locate home directory: %w", err)
	}
	path := filepath.Join(home, ".claude", ".credentials.json")
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return fmt.Errorf("Claude Code credentials not found at %s\nRun 'claude /login' (Claude Code CLI) to authenticate, then retry.", path)
	}
	if err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("expected credentials file at %s but found a directory.\nRemove it and run 'claude /login' to re-authenticate.", path)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w\nCheck file permissions and re-run.", path, err)
	}
	var creds map[string]any
	if err := json.Unmarshal(raw, &creds); err != nil {
		return fmt.Errorf("credentials file at %s is not valid JSON: %w\nRun 'claude /login' to re-authenticate.", path, err)
	}
	if extractClaudeAccessToken(creds) == "" {
		return fmt.Errorf("no access token found in %s\nRun 'claude /login' to re-authenticate.", path)
	}
	return nil
}

// extractClaudeAccessToken checks the current nested format before the legacy top-level keys.
func extractClaudeAccessToken(creds map[string]any) string {
	if oauth, ok := creds["claudeAiOauth"].(map[string]any); ok {
		if tok, _ := oauth["accessToken"].(string); tok != "" {
			return tok
		}
	}
	if tok, _ := creds["accessToken"].(string); tok != "" {
		return tok
	}
	if tok, _ := creds["oauthToken"].(string); tok != "" {
		return tok
	}
	return ""
}

// AppendEnvLine appends a KEY=VALUE line to an existing .env file.
// If the key is already present, it is left unchanged.
func AppendEnvLine(path, key, value string) error {
	existing, _ := os.ReadFile(path)
	// If key already present, skip
	for _, line := range strings.Split(string(existing), "\n") {
		if k, _, ok := parseEnvLine(strings.TrimSpace(line)); ok && k == key {
			return nil // already set
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "\n%s=%s\n", key, value)
	return err
}

// BackfillEnvFromEmbed adds missing active defaults without overwriting existing keys.
// It creates .env.bak before the first append and returns the keys added.
func BackfillEnvFromEmbed(envPath string) ([]string, error) {
	data, err := os.ReadFile(envPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	present := make(map[string]bool)
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if k, _, ok := parseEnvLine(trimmed); ok {
			present[k] = true
		}
	}

	var added []string
	var toAppend []string
	seen := make(map[string]bool)
	for _, line := range strings.Split(EnvTemplate, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		k, _, ok := parseEnvLine(trimmed)
		if !ok || present[k] || seen[k] {
			continue
		}
		seen[k] = true
		added = append(added, k)
		toAppend = append(toAppend, trimmed)
	}
	if len(toAppend) == 0 {
		return nil, nil
	}

	backupPath := envPath + ".bak"
	if _, statErr := os.Stat(backupPath); os.IsNotExist(statErr) {
		if err := os.WriteFile(backupPath, data, 0o600); err != nil {
			return nil, fmt.Errorf("write backup %s: %w", backupPath, err)
		}
	}

	var b strings.Builder
	b.Write(data)
	if len(data) > 0 && !strings.HasSuffix(string(data), "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n# --- Backfilled by `raptix start` (new keys from this release) ---\n")
	for _, line := range toAppend {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(envPath, []byte(b.String()), 0o600); err != nil {
		return nil, err
	}
	return added, nil
}

// SetEnvKey replaces the first active entry or appends the key if missing.
func SetEnvKey(path, key, value string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	replaced := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if k, _, ok := parseEnvLine(trimmed); ok && k == key {
			lines[i] = key + "=" + value
			replaced = true
			break
		}
	}
	if !replaced {
		lines = append(lines, key+"="+value)
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o600)
}

// Get returns a config value with a fallback default.
func Get(env map[string]string, key, fallback string) string {
	if val, ok := env[key]; ok && val != "" {
		return val
	}
	return fallback
}

// MigrateActiveComposeProfiles comments out active profile entries so optional workloads stay off at startup.
// It preserves original values in comments and creates a backup only if none exists.
func MigrateActiveComposeProfiles(envPath string) (bool, error) {
	data, err := os.ReadFile(envPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	lines := strings.Split(string(data), "\n")
	rewritten := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if k, _, ok := parseEnvLine(trimmed); ok && k == "COMPOSE_PROFILES" {
			lines[i] = "# [v1.1.8 ADR-0006 migration] specialist workloads now spawn via ops_start; was: " + line
			rewritten = true
		}
	}
	if !rewritten {
		return false, nil
	}
	backupPath := envPath + ".bak"
	if _, statErr := os.Stat(backupPath); os.IsNotExist(statErr) {
		if err := os.WriteFile(backupPath, data, 0o600); err != nil {
			return false, fmt.Errorf("write backup %s: %w", backupPath, err)
		}
	}
	if err := os.WriteFile(envPath, []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

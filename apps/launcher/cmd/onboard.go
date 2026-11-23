package cmd

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"charm.land/huh/v2"
	"github.com/Akapi895/raptix/apps/launcher/cmd/opscontrol"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/migrate"
	"github.com/Akapi895/raptix/apps/launcher/internal/platform"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
	"github.com/spf13/cobra"
)

// onboardOllamaProbeBudget bounds how long form construction waits for discovery.
const onboardOllamaProbeBudget = 3 * time.Second

var resetFlag bool

var onboardCmd = &cobra.Command{
	Use:   "onboard",
	Short: "Configure Raptix (auth methods, model profile, observability)",
	RunE:  runOnboard,
}

func init() {
	onboardCmd.Flags().BoolVar(&resetFlag, "reset", false, "Reconfigure even if .env already exists")
	rootCmd.AddCommand(onboardCmd)
}

// claudeSetupTokenDocsURL is the official Claude Code page covering
// `claude setup-token` (mint a long-lived 1-year OAuth token for headless use).
const claudeSetupTokenDocsURL = "https://code.claude.com/docs/en/authentication"

// AuthMethod identifiers — must match raptix/intelligence/llm/models.py::AuthMethod.
const (
	methodAnthropicOAuth = "anthropic_oauth"
	methodAnthropicAPI   = "anthropic_api"
	methodOpenAIOAuth    = "openai_oauth"
	methodOpenAIAPI      = "openai_api"
	methodGoogleAPI      = "google_api"
	methodMiniMaxAPI     = "minimax_api"
	methodDeepSeekAPI    = "deepseek_api"
	methodXAIAPI         = "xai_api"
	methodMistralAPI     = "mistral_api"
	methodOpenRouterAPI  = "openrouter_api"
	methodNvidiaAPI      = "nvidia_api"
	methodOllamaLocal    = "ollama_local"
	methodOllamaCloud    = "ollama_cloud"
	// Cloud gateways added in the OpenClaude provider migration.
	methodBedrockAPI      = "bedrock_api"
	methodVertexAPI       = "vertex_api"
	methodAzureAPI        = "azure_api"
	methodGroqAPI         = "groq_api"
	methodTogetherAPI     = "together_api"
	methodFireworksAPI    = "fireworks_api"
	methodCohereAPI       = "cohere_api"
	methodMoonshotAPI     = "moonshot_api"
	methodKimiAPI         = "kimi_api"
	methodZaiAPI          = "zai_api"
	methodDashscopeAPI    = "dashscope_api"
	methodGitHubModelsAPI = "github_models_api"
	methodLMStudioLocal   = "lmstudio_local"
	methodCustomOpenAIAPI = "custom_openai_api"
)

// Defaults shown in form placeholders for the new providers.
const (
	defaultLMStudioAPIBase = "http://host.docker.internal:1234/v1"
	defaultLMStudioModel   = "qwen2.5-coder-7b-instruct"
	defaultAzureAPIVersion = "2024-08-01-preview"
)

// Containers reach host Ollama through Compose's host-gateway mapping.
// Ollama must listen on a host address accessible from Docker.
const (
	defaultOllamaAPIBase = "http://host.docker.internal:11434"
	defaultOllamaModel   = "llama3.2"
)

// methodOrder sets the default RAPTIX_AUTH_PRIORITY. OAuth precedes the matching paid API, and Ollama comes last.
var methodOrder = []string{
	methodAnthropicOAuth,
	methodAnthropicAPI,
	methodOpenAIOAuth,
	methodOpenAIAPI,
	methodGoogleAPI,
	methodMiniMaxAPI,
	methodDeepSeekAPI,
	methodXAIAPI,
	methodMistralAPI,
	methodOpenRouterAPI,
	methodNvidiaAPI,
	// Cloud gateways — anthropic-via-cloud paths first, then
	// other multi-vendor hubs.
	methodBedrockAPI,
	methodVertexAPI,
	methodAzureAPI,
	methodGitHubModelsAPI,
	methodGroqAPI,
	methodTogetherAPI,
	methodFireworksAPI,
	methodCohereAPI,
	methodMoonshotAPI,
	methodKimiAPI,
	methodZaiAPI,
	methodDashscopeAPI,
	// Local last so cloud-preferred default still picks remote
	// providers as primary; users can re-order in .env.
	methodLMStudioLocal,
	methodOllamaLocal,
	methodOllamaCloud,
	methodCustomOpenAIAPI,
}

// systemCheckGroup shows Docker readiness without blocking onboarding.
func systemCheckGroup(sys platform.SystemInfo) *huh.Group {
	var b strings.Builder

	osLine := sys.OSLabel() + "  (" + sys.Arch + ")"
	if sys.IsWSL {
		osLine += " · WSL2"
	}
	b.WriteString("OS       " + osLine + "\n")

	docker := "not installed"
	if sys.DockerInstalled {
		docker = "installed"
		if sys.DockerRunning {
			docker += " · running"
		} else {
			docker += " · stopped"
		}
		if sys.ComposeAvailable {
			docker += " · compose v2"
		}
	}
	b.WriteString("Docker   " + docker + "\n\n")

	if sys.Ready() {
		b.WriteString("This system is ready to run Raptix.")
	} else {
		b.WriteString(sys.DockerHint() + "\n")
		b.WriteString("You can still configure credentials now and sort out Docker before launching.")
	}

	return huh.NewGroup(
		huh.NewNote().
			Title("System Check").
			Description(b.String()),
	)
}

func runOnboard(cmd *cobra.Command, args []string) error {
	if config.EnvExists() && !resetFlag {
		ui.Info(".env already configured at " + config.EnvPath())
		ui.DimText("Run 'raptix onboard --reset' to reconfigure")
		return nil
	}
	existingEnv := map[string]string{}
	if config.EnvExists() {
		var err error
		existingEnv, err = config.LoadEnv(config.EnvPath())
		if err != nil {
			return fmt.Errorf("read existing .env: %w", err)
		}
	}

	// Discover Ollama models while building the form.
	probeCh := make(chan ollamaProbeResult, 1)
	go func() {
		probeCh <- probeOllamaForOnboard(defaultOllamaAPIBase)
	}()

	var (
		methods          []string
		anthropicKey     string
		claudeOAuthToken string
		openaiKey        string
		geminiKey        string
		minimaxKey       string
		deepseekKey      string
		xaiKey           string
		mistralKey       string
		openrouterKey    string
		nvidiaKey        string
		ollamaAPIBase    = defaultOllamaAPIBase
		ollamaModel      = defaultOllamaModel
		// Cloud gateways
		awsAccessKeyID     string
		awsSecretAccessKey string
		awsRegion          = "us-east-1"
		vertexCredsPath    string
		vertexProject      string
		vertexLocation     = "us-central1"
		azureAPIKey        string
		azureAPIBase       string
		azureAPIVersion    = defaultAzureAPIVersion
		groqKey            string
		togetherKey        string
		fireworksKey       string
		cohereKey          string
		moonshotKey        string
		kimiKey            string
		zaiKey             string
		dashscopeKey       string
		githubToken        string
		// Cloud Ollama
		ollamaCloudAPIBase string
		ollamaCloudAPIKey  string
		ollamaCloudModel   string
		// LM Studio (local OpenAI-compatible)
		lmStudioAPIBase = defaultLMStudioAPIBase
		lmStudioModel   = defaultLMStudioModel
		// Custom OpenAI-compatible endpoint
		customOpenAIAPIBase string
		customOpenAIAPIKey  string
		customOpenAIModel   string
		profile             string
		language            = "en"
		useLangSmith        bool
		langSmithKey        string
		telemetryConsent    = true // opt-out: default to sharing (masked)
	)
	// A timed-out probe is treated as unreachable.
	probeTimer := time.NewTimer(onboardOllamaProbeBudget)
	var ollamaProbe ollamaProbeResult
	select {
	case ollamaProbe = <-probeCh:
		probeTimer.Stop()
	case <-probeTimer.C:
	}
	ollamaModelField := buildOllamaModelField(ollamaProbe, &ollamaModel)

	sysInfo := platform.Detect()

	form := huh.NewForm(
		systemCheckGroup(sysInfo),

		// Intro
		huh.NewGroup(
			huh.NewNote().
				Title("Raptix Setup").
				Description("Configure auth methods, model profile, and\nobservability.\n\nUse ↑↓ to navigate, space to toggle, Enter to confirm."),
		),

		huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Auth Methods").
				Description("Press SPACE to toggle, ENTER to confirm.\nUse ↑↓ to scroll, '/' to filter the list.\nPick every credential you have — each is an\nindependent fallback in priority order.").
				Filterable(true).
				Height(15).
				Options(
					huh.NewOption("Claude Code OAuth — Anthropic subscription (auth/*)", methodAnthropicOAuth),
					huh.NewOption("Anthropic API Key — sk-ant-...", methodAnthropicAPI),
					huh.NewOption("ChatGPT OAuth     — ChatGPT Pro/Plus/Team subscription via `codex login` (auth/gpt-*)", methodOpenAIOAuth),
					huh.NewOption("OpenAI API Key    — sk-...", methodOpenAIAPI),
					huh.NewOption("Google API Key    — AIza... (Gemini)", methodGoogleAPI),
					huh.NewOption("MiniMax API Key   — eyJ...", methodMiniMaxAPI),
					huh.NewOption("DeepSeek API Key  — sk-...", methodDeepSeekAPI),
					huh.NewOption("xAI API Key       — xai-... (Grok)", methodXAIAPI),
					huh.NewOption("Mistral API Key   — (no fixed prefix)", methodMistralAPI),
					huh.NewOption("OpenRouter API Key — sk-or-...", methodOpenRouterAPI),
					huh.NewOption("Nvidia NIM API Key — nvapi-...", methodNvidiaAPI),
					huh.NewOption("AWS Bedrock         — Anthropic models on AWS (bedrock/*)", methodBedrockAPI),
					huh.NewOption("GCP Vertex AI       — Anthropic + Gemini on GCP (vertex_ai/*)", methodVertexAPI),
					huh.NewOption("Azure OpenAI        — Azure-hosted GPT deployments (azure/*)", methodAzureAPI),
					huh.NewOption("GitHub Models       — GPT family via GitHub PAT (github/*)", methodGitHubModelsAPI),
					huh.NewOption("Groq Cloud          — LPU-accelerated Llama (groq/*)", methodGroqAPI),
					huh.NewOption("Together AI         — Llama / Mixtral hub (together_ai/*)", methodTogetherAPI),
					huh.NewOption("Fireworks AI        — Llama / Mixtral hub (fireworks_ai/*)", methodFireworksAPI),
					huh.NewOption("Cohere Command      — Command-A / Command-R (cohere/*)", methodCohereAPI),
					huh.NewOption("Moonshot Kimi K2    — Kimi K2 (moonshot/*)", methodMoonshotAPI),
					huh.NewOption("Kimi for Coding     — Kimi K3 / K2.7 Coding (kimi/*)", methodKimiAPI),
					huh.NewOption("Z.ai GLM-4.5        — GLM-4.5 / GLM-4.5-Air (zai/*)", methodZaiAPI),
					huh.NewOption("Alibaba DashScope   — Qwen Max/Plus/Turbo (dashscope/*)", methodDashscopeAPI),
					huh.NewOption("LM Studio (local)   — local OpenAI-compatible server (lm_studio/*)", methodLMStudioLocal),
					huh.NewOption("Local LLM (Ollama)  — any pulled model, no API key", methodOllamaLocal),
					huh.NewOption("Ollama Cloud        — hosted Ollama (ollama_chat/* via cloud)", methodOllamaCloud),
					huh.NewOption("Custom OpenAI Endpoint — bring-your-own OpenAI-compatible URL", methodCustomOpenAIAPI),
				).
				Value(&methods).
				Validate(func(s []string) error {
					if len(s) == 0 {
						return fmt.Errorf("select at least one credential")
					}
					return nil
				}),
		).Title("1 / 5  ·  Credentials").
			Description("Select all that apply"),

		// A long-lived Claude token overrides credentials from the local login.
		huh.NewGroup(
			huh.NewNote().
				Title("Claude Code Subscription — 1-year token").
				Description(
					"Two steps:\n\n"+
						"1) Generate a 1-year token — run:\n"+
						"      claude setup-token\n"+
						"   (opens browser OAuth; needs a Pro / Max / Team /\n"+
						"   Enterprise plan). Docs / issue link:\n"+
						"   "+claudeSetupTokenDocsURL+"\n\n"+
						"2) Paste the sk-ant-oat01-… token it prints into the\n"+
						"   field below.\n\n"+
						"Headless-safe: never refreshed, no live Claude Code\n"+
						"session. Leave blank to use a rotating\n"+
						"~/.claude/.credentials.json from a `claude` login.",
				),
			huh.NewInput().
				Title("ANTHROPIC_OAUTH_TOKEN").
				Placeholder("sk-ant-oat01-...   (leave blank to use credentials file)").
				EchoMode(huh.EchoModePassword).
				Value(&claudeOAuthToken).
				Validate(optionalClaudeOAuthToken),
		).Title("2 / 5  ·  Claude Code Subscription").
			WithHideFunc(func() bool { return !contains(methods, methodAnthropicOAuth) }),

		huh.NewGroup(
			huh.NewInput().
				Title("Anthropic API Key").
				Placeholder("sk-ant-...").
				EchoMode(huh.EchoModePassword).
				Value(&anthropicKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Anthropic API").
			WithHideFunc(func() bool { return !contains(methods, methodAnthropicAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("OpenAI API Key").
				Placeholder("sk-...").
				EchoMode(huh.EchoModePassword).
				Value(&openaiKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  OpenAI API").
			WithHideFunc(func() bool { return !contains(methods, methodOpenAIAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("Google (Gemini) API Key").
				Placeholder("AIza...").
				EchoMode(huh.EchoModePassword).
				Value(&geminiKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Google API").
			WithHideFunc(func() bool { return !contains(methods, methodGoogleAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("MiniMax API Key").
				Placeholder("eyJ...").
				EchoMode(huh.EchoModePassword).
				Value(&minimaxKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  MiniMax API").
			WithHideFunc(func() bool { return !contains(methods, methodMiniMaxAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("DeepSeek API Key").
				Placeholder("sk-...").
				EchoMode(huh.EchoModePassword).
				Value(&deepseekKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  DeepSeek API").
			WithHideFunc(func() bool { return !contains(methods, methodDeepSeekAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("xAI API Key").
				Placeholder("xai-...").
				EchoMode(huh.EchoModePassword).
				Value(&xaiKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  xAI API (Grok)").
			WithHideFunc(func() bool { return !contains(methods, methodXAIAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("Mistral API Key").
				Placeholder("paste your Mistral API key").
				EchoMode(huh.EchoModePassword).
				Value(&mistralKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Mistral API").
			WithHideFunc(func() bool { return !contains(methods, methodMistralAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("OpenRouter API Key").
				Placeholder("sk-or-...").
				EchoMode(huh.EchoModePassword).
				Value(&openrouterKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  OpenRouter API").
			WithHideFunc(func() bool { return !contains(methods, methodOpenRouterAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("Nvidia NIM API Key").
				Placeholder("nvapi-...").
				EchoMode(huh.EchoModePassword).
				Value(&nvidiaKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Nvidia NIM API").
			WithHideFunc(func() bool { return !contains(methods, methodNvidiaAPI) }),

		huh.NewGroup(
			huh.NewNote().
				Title("Local Ollama").
				Description("Ollama must already be running on your host with\nat least one tool-capable model pulled. Launch it\nbound to all interfaces so the Raptix container\ncan reach it:\n\n  OLLAMA_HOST=0.0.0.0:11434 ollama serve\n\nThe default 127.0.0.1 binding only accepts host-side\nconnections — containers won't see it.\n\nThe default URL `host.docker.internal:11434` works\non macOS, Linux, and WSL2 (with or without Docker\nDesktop). Only change it for remote / custom setups.\nNote: the model list is probed against the default URL\nat wizard start; if you customize OLLAMA_API_BASE,\nfinish the wizard then re-run 'raptix onboard\n--reset' so the probe targets the new endpoint."),
			huh.NewInput().
				Title("OLLAMA_API_BASE").
				Placeholder(defaultOllamaAPIBase).
				Value(&ollamaAPIBase).
				Validate(nonEmpty),
			ollamaModelField,
		).Title("2 / 5  ·  Local LLM (Ollama)").
			WithHideFunc(func() bool { return !contains(methods, methodOllamaLocal) }),

		huh.NewGroup(
			huh.NewNote().
				Title("AWS Bedrock").
				Description("Bedrock uses AWS SigV4 — provide IAM access key,\nsecret, and the region where Anthropic models are\nenabled (us-east-1 or us-west-2 typically)."),
			huh.NewInput().
				Title("AWS_ACCESS_KEY_ID").
				Placeholder("AKIA...").
				Value(&awsAccessKeyID).
				Validate(nonEmpty),
			huh.NewInput().
				Title("AWS_SECRET_ACCESS_KEY").
				EchoMode(huh.EchoModePassword).
				Value(&awsSecretAccessKey).
				Validate(nonEmpty),
			huh.NewInput().
				Title("AWS_REGION").
				Placeholder("us-east-1").
				Value(&awsRegion).
				Validate(nonEmpty),
		).Title("2 / 5  ·  AWS Bedrock").
			WithHideFunc(func() bool { return !contains(methods, methodBedrockAPI) }),

		huh.NewGroup(
			huh.NewNote().
				Title("GCP Vertex AI").
				Description("Vertex AI uses a Google Cloud service-account JSON.\nDownload one from IAM & Admin → Service Accounts and\npaste the absolute file path. Project + region must\nmatch where you enabled Anthropic + Gemini models."),
			huh.NewInput().
				Title("GOOGLE_APPLICATION_CREDENTIALS").
				Placeholder("/abs/path/to/service-account.json").
				Value(&vertexCredsPath).
				Validate(nonEmpty),
			huh.NewInput().
				Title("VERTEXAI_PROJECT").
				Placeholder("my-gcp-project-id").
				Value(&vertexProject).
				Validate(nonEmpty),
			huh.NewInput().
				Title("VERTEXAI_LOCATION").
				Placeholder("us-central1").
				Value(&vertexLocation).
				Validate(nonEmpty),
		).Title("2 / 5  ·  GCP Vertex AI").
			WithHideFunc(func() bool { return !contains(methods, methodVertexAPI) }),

		huh.NewGroup(
			huh.NewNote().
				Title("Azure OpenAI Service").
				Description("Endpoint is your azure-openai resource URL,\ne.g. https://my-resource.openai.azure.com.\nThe deployment names map 1:1 to gpt-5.5/gpt-5.4/...\nso the model matrix in DF resolves out of the box."),
			huh.NewInput().
				Title("AZURE_API_KEY").
				EchoMode(huh.EchoModePassword).
				Value(&azureAPIKey).
				Validate(nonEmpty),
			huh.NewInput().
				Title("AZURE_API_BASE").
				Placeholder("https://<resource>.openai.azure.com").
				Value(&azureAPIBase).
				Validate(nonEmpty),
			huh.NewInput().
				Title("AZURE_API_VERSION").
				Placeholder(defaultAzureAPIVersion).
				Value(&azureAPIVersion).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Azure OpenAI").
			WithHideFunc(func() bool { return !contains(methods, methodAzureAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("GITHUB_TOKEN").
				Description("Fine-grained PAT with the 'models' permission scope.\nGenerate at github.com/settings/personal-access-tokens.").
				Placeholder("github_pat_...").
				EchoMode(huh.EchoModePassword).
				Value(&githubToken).
				Validate(nonEmpty),
		).Title("2 / 5  ·  GitHub Models").
			WithHideFunc(func() bool { return !contains(methods, methodGitHubModelsAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("GROQ_API_KEY").
				Placeholder("gsk_...").
				EchoMode(huh.EchoModePassword).
				Value(&groqKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Groq Cloud").
			WithHideFunc(func() bool { return !contains(methods, methodGroqAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("TOGETHER_API_KEY").
				Placeholder("paste your Together AI API key").
				EchoMode(huh.EchoModePassword).
				Value(&togetherKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Together AI").
			WithHideFunc(func() bool { return !contains(methods, methodTogetherAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("FIREWORKS_API_KEY").
				Placeholder("fw_...").
				EchoMode(huh.EchoModePassword).
				Value(&fireworksKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Fireworks AI").
			WithHideFunc(func() bool { return !contains(methods, methodFireworksAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("COHERE_API_KEY").
				Placeholder("paste your Cohere API key").
				EchoMode(huh.EchoModePassword).
				Value(&cohereKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Cohere").
			WithHideFunc(func() bool { return !contains(methods, methodCohereAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("MOONSHOT_API_KEY").
				Placeholder("sk-...").
				EchoMode(huh.EchoModePassword).
				Value(&moonshotKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Moonshot Kimi K2").
			WithHideFunc(func() bool { return !contains(methods, methodMoonshotAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("KIMI_API_KEY").
				Description("Kimi for Coding platform (api.kimi.com/coding) — separate\nfrom the legacy Moonshot API. Keys start with 'sk-kimi-'.").
				Placeholder("sk-kimi-...").
				EchoMode(huh.EchoModePassword).
				Value(&kimiKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Kimi for Coding").
			WithHideFunc(func() bool { return !contains(methods, methodKimiAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("ZAI_API_KEY").
				Description("Z.ai is OpenAI-compatible — base URL is hard-wired to\nhttps://api.z.ai/api/paas/v4. Get a key at z.ai/manage.").
				Placeholder("paste your Z.ai API key").
				EchoMode(huh.EchoModePassword).
				Value(&zaiKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Z.ai GLM-4.5").
			WithHideFunc(func() bool { return !contains(methods, methodZaiAPI) }),

		huh.NewGroup(
			huh.NewInput().
				Title("DASHSCOPE_API_KEY").
				Placeholder("sk-...").
				EchoMode(huh.EchoModePassword).
				Value(&dashscopeKey).
				Validate(nonEmpty),
		).Title("2 / 5  ·  DashScope (Qwen)").
			WithHideFunc(func() bool { return !contains(methods, methodDashscopeAPI) }),

		huh.NewGroup(
			huh.NewNote().
				Title("LM Studio").
				Description("LM Studio runs a local OpenAI-compatible server.\nLaunch the LM Studio app and start the server\n(Developer tab → Start). The default port is 1234."),
			huh.NewInput().
				Title("LMSTUDIO_API_BASE").
				Placeholder(defaultLMStudioAPIBase).
				Value(&lmStudioAPIBase).
				Validate(nonEmpty),
			huh.NewInput().
				Title("LMSTUDIO_MODEL").
				Description("Model identifier as shown in LM Studio (e.g.\nqwen2.5-coder-7b-instruct).").
				Placeholder(defaultLMStudioModel).
				Value(&lmStudioModel).
				Validate(nonEmpty),
		).Title("2 / 5  ·  LM Studio").
			WithHideFunc(func() bool { return !contains(methods, methodLMStudioLocal) }),

		huh.NewGroup(
			huh.NewNote().
				Title("Ollama Cloud").
				Description("Hosted Ollama — same /api/chat tool-calling endpoint\nas local Ollama, just behind an API key."),
			huh.NewInput().
				Title("OLLAMA_CLOUD_API_BASE").
				Placeholder("https://api.ollama.com/v1").
				Value(&ollamaCloudAPIBase).
				Validate(nonEmpty),
			huh.NewInput().
				Title("OLLAMA_CLOUD_API_KEY").
				EchoMode(huh.EchoModePassword).
				Value(&ollamaCloudAPIKey).
				Validate(nonEmpty),
			huh.NewInput().
				Title("OLLAMA_CLOUD_MODEL").
				Placeholder("llama3.3:70b").
				Value(&ollamaCloudModel).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Ollama Cloud").
			WithHideFunc(func() bool { return !contains(methods, methodOllamaCloud) }),

		huh.NewGroup(
			huh.NewNote().
				Title("Custom OpenAI-compatible Endpoint").
				Description("Point at any OpenAI-compatible server (gateways,\nself-hosted vLLM, internal LiteLLM, etc.). The model\nname is sent verbatim to the upstream — match what\nyour gateway exposes."),
			huh.NewInput().
				Title("CUSTOM_OPENAI_API_BASE").
				Placeholder("https://gateway.example.com/v1").
				Value(&customOpenAIAPIBase).
				Validate(nonEmpty),
			huh.NewInput().
				Title("CUSTOM_OPENAI_API_KEY").
				EchoMode(huh.EchoModePassword).
				Value(&customOpenAIAPIKey).
				Validate(nonEmpty),
			huh.NewInput().
				Title("CUSTOM_OPENAI_MODEL").
				Placeholder("gpt-4o-mini").
				Value(&customOpenAIModel).
				Validate(nonEmpty),
		).Title("2 / 5  ·  Custom OpenAI Endpoint").
			WithHideFunc(func() bool { return !contains(methods, methodCustomOpenAIAPI) }),

		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Model Profile").
				Description("eco  per-agent tier (recommended)\nmax  every agent on HIGH (expensive)\ntest every agent on LOW (development)").
				Options(
					huh.NewOption("eco  — per-agent tier (recommended)", "eco"),
					huh.NewOption("max  — every agent on HIGH (expensive)", "max"),
					huh.NewOption("test — every agent on LOW (development)", "test"),
				).
				Value(&profile),
		).Title("3 / 5  ·  Profile"),

		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Agent Language").
				Description("Language for all agent prose output (menus, questions,\nsummaries, errors). Technical output stays in English.\nCountry codes (dk, se, jp, cn) are auto-resolved.").
				Options(
					huh.NewOption("en     — English (default)", "en"),
					huh.NewOption("no     — Norwegian", "no"),
					huh.NewOption("da     — Danish", "da"),
					huh.NewOption("sv     — Swedish", "sv"),
					huh.NewOption("fi     — Finnish", "fi"),
					huh.NewOption("is     — Icelandic", "is"),
					huh.NewOption("ko     — Korean", "ko"),
					huh.NewOption("ja     — Japanese", "ja"),
					huh.NewOption("zh     — Chinese", "zh"),
					huh.NewOption("zh-tw  — Traditional Chinese", "zh-tw"),
					huh.NewOption("es     — Spanish", "es"),
					huh.NewOption("pt     — Portuguese", "pt"),
					huh.NewOption("pt-br  — Brazilian Portuguese", "pt-br"),
					huh.NewOption("de     — German", "de"),
					huh.NewOption("fr     — French", "fr"),
					huh.NewOption("nl     — Dutch", "nl"),
					huh.NewOption("it     — Italian", "it"),
					huh.NewOption("pl     — Polish", "pl"),
					huh.NewOption("cs     — Czech", "cs"),
					huh.NewOption("uk     — Ukrainian", "uk"),
					huh.NewOption("ro     — Romanian", "ro"),
					huh.NewOption("hr     — Croatian", "hr"),
					huh.NewOption("bg     — Bulgarian", "bg"),
					huh.NewOption("ru     — Russian", "ru"),
					huh.NewOption("el     — Greek", "el"),
					huh.NewOption("hu     — Hungarian", "hu"),
					huh.NewOption("tr     — Turkish", "tr"),
					huh.NewOption("ar     — Arabic", "ar"),
					huh.NewOption("fa     — Persian", "fa"),
					huh.NewOption("he     — Hebrew", "he"),
					huh.NewOption("hi     — Hindi", "hi"),
					huh.NewOption("th     — Thai", "th"),
					huh.NewOption("vi     — Vietnamese", "vi"),
					huh.NewOption("id     — Indonesian", "id"),
					huh.NewOption("ms     — Malay", "ms"),
					huh.NewOption("tl     — Filipino", "tl"),
					huh.NewOption("sw     — Swahili", "sw"),
					huh.NewOption("af     — Afrikaans", "af"),
					huh.NewOption("wenyan — 文言文 + English technical terms", "wenyan"),
				).
				Value(&language),
		).Title("4 / 5  ·  Language"),

		huh.NewGroup(
			huh.NewConfirm().
				Title("Enable LangSmith?").
				Description("LLM observability and trace collection").
				Affirmative("Yes").
				Negative("No").
				Value(&useLangSmith),
		).Title("5 / 5  ·  Observability"),

		huh.NewGroup(
			huh.NewInput().
				Title("LangSmith API Key").
				Placeholder("lsv2_...").
				EchoMode(huh.EchoModePassword).
				Value(&langSmithKey).
				Validate(nonEmpty),
		).Title("5 / 5  ·  LangSmith").
			WithHideFunc(func() bool { return !useLangSmith }),

		huh.NewGroup(
			huh.NewConfirm().
				Title("Share anonymous + masked red-team telemetry?").
				Description(
					"Raptix is free/OSS — sharing usage helps fund and improve it,\n"+
						"and contributes masked red-team reasoning to train future open\n"+
						"offensive-security agents.\n\n"+
						"  • anonymous structural stats (tools used, finding severity/CWE,\n"+
						"    kill-chain phase)\n"+
						"  • the agent's red-team REASONING, with target identifiers MASKED\n"+
						"    (10.0.0.5 -> <HOST_1>, acme.com -> <DOMAIN_1>)\n\n"+
						"Never sent: raw prompts, real target IPs/hosts, credentials. Your\n"+
						"IP is dropped at the gateway. Change anytime: RAPTIX_TELEMETRY=off\n"+
						"(or basic) in .env, `raptix-cli telemetry off`, or DO_NOT_TRACK=1.",
				).
				Affirmative("Yes, share (recommended)").
				Negative("No, keep it off").
				Value(&telemetryConsent),
		).Title("5 / 5  ·  Usage telemetry"),
	).WithTheme(huh.ThemeFunc(ui.RaptixTheme))

	if err := form.Run(); err != nil {
		return fmt.Errorf("setup cancelled: %w", err)
	}

	// Opt-out telemetry: consent maps to the research tier (masked
	// reasoning corpus); declining writes an explicit off.
	telemetryChoice := "research"
	if !telemetryConsent {
		telemetryChoice = "off"
	}

	// Require a tool-capable model before writing .env.
	if contains(methods, methodOllamaLocal) && len(ollamaProbe.ToolCapableModels) == 0 {
		return ollamaUnusableError(ollamaProbe, ollamaAPIBase)
	}

	priority := make([]string, 0, len(methods))
	for _, m := range methodOrder {
		if contains(methods, m) {
			priority = append(priority, m)
		}
	}
	installationSecrets, err := onboardingInstallationSecrets(existingEnv)
	if err != nil {
		return fmt.Errorf("generate installation credentials: %w", err)
	}

	values := map[string]string{
		"RAPTIX_MODEL_PROFILE":    profile,
		"RAPTIX_LANGUAGE":         language,
		"RAPTIX_AUTH_PRIORITY":    strings.Join(priority, ","),
		"RAPTIX_AUTH_CLAUDE_CODE": boolStr(contains(methods, methodAnthropicOAuth)),
		"RAPTIX_AUTH_CHATGPT":     boolStr(contains(methods, methodOpenAIOAuth)),
		"LITELLM_MASTER_KEY":      installationSecrets.LiteLLMMasterKey,
		"LITELLM_SALT_KEY":        installationSecrets.LiteLLMSaltKey,
		"POSTGRES_PASSWORD":       installationSecrets.PostgresPassword,
		"NEO4J_PASSWORD":          installationSecrets.Neo4jPassword,
	}

	if anthropicKey != "" {
		values["ANTHROPIC_API_KEY"] = anthropicKey
	}
	if claudeOAuthToken != "" {
		// An explicit setup token is treated as non-refreshable.
		values["ANTHROPIC_OAUTH_TOKEN"] = strings.TrimSpace(claudeOAuthToken)
	}
	if openaiKey != "" {
		values["OPENAI_API_KEY"] = openaiKey
	}
	if geminiKey != "" {
		values["GEMINI_API_KEY"] = geminiKey
	}
	if minimaxKey != "" {
		values["MINIMAX_API_KEY"] = minimaxKey
	}
	if deepseekKey != "" {
		values["DEEPSEEK_API_KEY"] = deepseekKey
	}
	if xaiKey != "" {
		values["XAI_API_KEY"] = xaiKey
	}
	if mistralKey != "" {
		values["MISTRAL_API_KEY"] = mistralKey
	}
	if openrouterKey != "" {
		values["OPENROUTER_API_KEY"] = openrouterKey
	}
	if nvidiaKey != "" {
		values["NVIDIA_API_KEY"] = nvidiaKey
	}
	if contains(methods, methodOllamaLocal) {
		values["OLLAMA_API_BASE"] = strings.TrimSpace(ollamaAPIBase)
		values["OLLAMA_MODEL"] = strings.TrimSpace(ollamaModel)
	}
	if contains(methods, methodOllamaCloud) {
		values["OLLAMA_CLOUD_API_BASE"] = strings.TrimSpace(ollamaCloudAPIBase)
		values["OLLAMA_CLOUD_API_KEY"] = strings.TrimSpace(ollamaCloudAPIKey)
		values["OLLAMA_CLOUD_MODEL"] = strings.TrimSpace(ollamaCloudModel)
	}
	if contains(methods, methodBedrockAPI) {
		values["AWS_ACCESS_KEY_ID"] = strings.TrimSpace(awsAccessKeyID)
		values["AWS_SECRET_ACCESS_KEY"] = strings.TrimSpace(awsSecretAccessKey)
		// LiteLLM's Bedrock provider reads AWS_REGION_NAME, not the
		// boto3-standard AWS_REGION. Set both for SDK compatibility.
		values["AWS_REGION_NAME"] = strings.TrimSpace(awsRegion)
		values["AWS_REGION"] = strings.TrimSpace(awsRegion)
	}
	if contains(methods, methodVertexAPI) {
		values["GOOGLE_APPLICATION_CREDENTIALS"] = strings.TrimSpace(vertexCredsPath)
		values["VERTEXAI_PROJECT"] = strings.TrimSpace(vertexProject)
		values["VERTEXAI_LOCATION"] = strings.TrimSpace(vertexLocation)
	}
	if contains(methods, methodAzureAPI) {
		values["AZURE_API_KEY"] = strings.TrimSpace(azureAPIKey)
		values["AZURE_API_BASE"] = strings.TrimSpace(azureAPIBase)
		values["AZURE_API_VERSION"] = strings.TrimSpace(azureAPIVersion)
	}
	if githubToken != "" {
		// LiteLLM reads GITHUB_API_KEY, while the GitHub CLI reads GITHUB_TOKEN.
		values["GITHUB_TOKEN"] = strings.TrimSpace(githubToken)
		values["GITHUB_API_KEY"] = strings.TrimSpace(githubToken)
	}
	if groqKey != "" {
		values["GROQ_API_KEY"] = strings.TrimSpace(groqKey)
	}
	if togetherKey != "" {
		values["TOGETHER_API_KEY"] = strings.TrimSpace(togetherKey)
	}
	if fireworksKey != "" {
		values["FIREWORKS_API_KEY"] = strings.TrimSpace(fireworksKey)
	}
	if cohereKey != "" {
		values["COHERE_API_KEY"] = strings.TrimSpace(cohereKey)
	}
	if moonshotKey != "" {
		values["MOONSHOT_API_KEY"] = strings.TrimSpace(moonshotKey)
	}
	if kimiKey != "" {
		values["KIMI_API_KEY"] = strings.TrimSpace(kimiKey)
	}
	if zaiKey != "" {
		values["ZAI_API_KEY"] = strings.TrimSpace(zaiKey)
	}
	if dashscopeKey != "" {
		values["DASHSCOPE_API_KEY"] = strings.TrimSpace(dashscopeKey)
	}
	if contains(methods, methodLMStudioLocal) {
		values["LMSTUDIO_API_BASE"] = strings.TrimSpace(lmStudioAPIBase)
		values["LMSTUDIO_MODEL"] = strings.TrimSpace(lmStudioModel)
		// LM Studio accepts a placeholder key for the OpenAI-compatible client.
		values["LMSTUDIO_API_KEY"] = "lm-studio"
	}
	if contains(methods, methodCustomOpenAIAPI) {
		values["CUSTOM_OPENAI_API_BASE"] = strings.TrimSpace(customOpenAIAPIBase)
		values["CUSTOM_OPENAI_API_KEY"] = strings.TrimSpace(customOpenAIAPIKey)
		values["CUSTOM_OPENAI_MODEL"] = strings.TrimSpace(customOpenAIModel)
	}

	if useLangSmith && langSmithKey != "" {
		values["LANGSMITH_TRACING"] = "true"
		values["LANGSMITH_API_KEY"] = langSmithKey
		values["LANGSMITH_PROJECT"] = "raptix"
	}

	// Telemetry requires consent and a configured endpoint.
	values["RAPTIX_TELEMETRY"] = telemetryChoice

	if err := config.WriteEnvFromEmbed(config.EnvPath(), values); err != nil {
		return fmt.Errorf("write .env: %w", err)
	}

	// Record the consent answer so the startup migration can skip the prompt.
	if err := migrate.MarkAcked(config.RaptixHome(), migrate.TelemetryPolicyID); err != nil {
		ui.Warning("Could not record telemetry consent ack: " + err.Error())
	}

	// Summary
	fmt.Println()
	fmt.Println(ui.Green.Render("  ✓ Configuration saved"))
	fmt.Println()
	fmt.Println(ui.Dim.Render("  ┌──────────────────────────────────┐"))
	fmt.Println(ui.Dim.Render("  │") + ui.Cyan.Render("  Methods   ") + ui.Dim.Render(strings.Join(priority, ", ")))
	fmt.Println(ui.Dim.Render("  │") + ui.Cyan.Render("  Profile   ") + ui.Dim.Render(profile))
	fmt.Println(ui.Dim.Render("  │") + ui.Cyan.Render("  Language  ") + ui.Dim.Render(language))
	if useLangSmith {
		fmt.Println(ui.Dim.Render("  │") + ui.Cyan.Render("  LangSmith ") + ui.Green.Render("enabled"))
	}
	if telemetryChoice != "off" {
		fmt.Println(ui.Dim.Render("  │") + ui.Cyan.Render("  Telemetry ") + ui.Green.Render(telemetryChoice))
	}
	fmt.Println(ui.Dim.Render("  │"))
	fmt.Println(ui.Dim.Render("  │  ") + ui.Dim.Render(config.EnvPath()))
	fmt.Println(ui.Dim.Render("  └──────────────────────────────────┘"))
	fmt.Println()

	// Refresh the service definition on rerun. Hosts without a service manager use the startup fallback.
	fmt.Println()
	if err := opscontrol.EnsureInstalled(); err != nil {
		// Non-fatal: onboarding can complete without managed-service
		// mode, the user will just stay on launcher-spawn fallback.
		ui.Warning("opscontrol install skipped: " + err.Error())
	}
	fmt.Println()

	ui.DimText("  Run 'raptix' to start the platform")
	return nil
}

func onboardingInstallationSecrets(existing map[string]string) (config.InstallationSecrets, error) {
	secrets, err := config.NewInstallationSecrets()
	if err != nil {
		return config.InstallationSecrets{}, err
	}
	if value := strings.TrimSpace(existing["LITELLM_MASTER_KEY"]); value != "" {
		secrets.LiteLLMMasterKey = value
	}
	if value := strings.TrimSpace(existing["LITELLM_SALT_KEY"]); value != "" {
		secrets.LiteLLMSaltKey = value
	}
	if value := strings.TrimSpace(existing["POSTGRES_PASSWORD"]); value != "" {
		secrets.PostgresPassword = value
	}
	if value := strings.TrimSpace(existing["NEO4J_PASSWORD"]); value != "" {
		secrets.Neo4jPassword = value
	}
	return secrets, nil
}

func contains(haystack []string, needle string) bool {
	return slices.Contains(haystack, needle)
}

func nonEmpty(s string) error {
	if strings.TrimSpace(s) == "" {
		return fmt.Errorf("value is required")
	}
	return nil
}

// optionalClaudeOAuthToken accepts a setup token or an empty value for local credentials.
func optionalClaudeOAuthToken(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	if !strings.HasPrefix(t, "sk-ant-oat01-") {
		return fmt.Errorf("expected a `claude setup-token` token starting with sk-ant-oat01- (leave blank to use the credentials file)")
	}
	return nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// buildOllamaModelField offers a model picker or a hint based on the probe result.
func buildOllamaModelField(probe ollamaProbeResult, selected *string) huh.Field {
	if len(probe.ToolCapableModels) > 0 {
		options := make([]huh.Option[string], 0, len(probe.ToolCapableModels))
		for _, m := range probe.ToolCapableModels {
			options = append(options, huh.NewOption(m, m))
		}
		if !slices.Contains(probe.ToolCapableModels, *selected) {
			*selected = probe.ToolCapableModels[0]
		}
		return huh.NewSelect[string]().
			Title("OLLAMA_MODEL").
			Description("Tool-capable models found on your host. Raptix\nagents always emit tool calls — these are the only\nmodels the wizard will accept.").
			Options(options...).
			Value(selected)
	}

	if probe.Reachable {
		return huh.NewNote().
			Title("OLLAMA_MODEL — no tool-capable models found").
			Description("Ollama is reachable but none of your pulled models\nadvertise the 'tools' capability. Raptix agents\nalways emit tool calls, so a model without tool\nsupport cannot power them.\n\n  ollama pull qwen3-coder:30b\n  ollama show qwen3-coder:30b   # capabilities should list 'tools'\n\nThen press Esc and re-run 'raptix onboard'.")
	}

	return huh.NewNote().
		Title("OLLAMA_MODEL — Ollama not reachable").
		Description("Could not reach Ollama at " + defaultOllamaAPIBase + ".\n\nMost likely Ollama isn't running or is bound to\n127.0.0.1 only (which the Raptix container can't\nsee). Launch it on all interfaces, pull a tool-capable\nmodel, then re-run the wizard:\n\n  OLLAMA_HOST=0.0.0.0:11434 ollama serve\n  ollama pull qwen3-coder:30b\n  ollama show qwen3-coder:30b   # capabilities should list 'tools'\n\nThen press Esc and re-run 'raptix onboard'.")
}

// ollamaUnusableError matches the setup hint to the probe result.
func ollamaUnusableError(probe ollamaProbeResult, baseURL string) error {
	if probe.Reachable {
		return fmt.Errorf(
			"Ollama selected but no tool-capable models found on the host.\n" +
				"Raptix agents always emit tool calls — pull a tool-capable\n" +
				"model and verify it advertises tools, then re-run:\n\n" +
				"  ollama pull qwen3-coder:30b\n" +
				"  ollama show qwen3-coder:30b   # capabilities should list 'tools'\n" +
				"  raptix onboard --reset")
	}
	return fmt.Errorf(
		"Ollama selected but the host probe could not reach %s.\n"+
			"Make sure Ollama is running and bound to all interfaces (the\n"+
			"default 127.0.0.1 binding is invisible to containers), then\n"+
			"pull a tool-capable model and re-run:\n\n"+
			"  OLLAMA_HOST=0.0.0.0:11434 ollama serve\n"+
			"  ollama pull qwen3-coder:30b\n"+
			"  ollama show qwen3-coder:30b   # capabilities should list 'tools'\n"+
			"  raptix onboard --reset",
		baseURL)
}

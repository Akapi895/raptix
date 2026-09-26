package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

const defaultServer = "http://127.0.0.1:8080"

// ExitError supplies a stable process status for command callers.
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
func (e *ExitError) Unwrap() error { return e.Err }

// ExitCode translates command failures into conventional CLI process codes.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var exit *ExitError
	if errors.As(err, &exit) {
		return exit.Code
	}
	if errors.Is(err, context.Canceled) {
		return 130
	}
	return 1
}

type commandState struct {
	server  string
	token   string
	timeout time.Duration
	json    bool
	stdout  io.Writer
	stderr  io.Writer
	http    *http.Client
}

func (s *commandState) client() (*client, error) {
	c, err := newClient(s.server, s.token, s.timeout, s.http)
	if err != nil {
		return nil, &ExitError{Code: 2, Err: err}
	}
	return c, nil
}

func (s *commandState) call(fn func(*client) error) error {
	c, err := s.client()
	if err != nil {
		return err
	}
	if err := fn(c); err != nil {
		return commandError(err)
	}
	return nil
}

func commandError(err error) error {
	if errors.Is(err, context.Canceled) {
		return &ExitError{Code: 130, Err: err}
	}
	var remote *ClientError
	if !errors.As(err, &remote) {
		return &ExitError{Code: 6, Err: fmt.Errorf("communicate with server: %w", err)}
	}
	switch remote.Status {
	case http.StatusBadRequest:
		return &ExitError{Code: 2, Err: remote}
	case http.StatusUnauthorized, http.StatusForbidden:
		return &ExitError{Code: 3, Err: remote}
	case http.StatusNotFound:
		return &ExitError{Code: 4, Err: remote}
	case http.StatusConflict, http.StatusUnprocessableEntity:
		return &ExitError{Code: 5, Err: remote}
	default:
		return &ExitError{Code: 6, Err: remote}
	}
}

func invalidf(format string, args ...any) error {
	return &ExitError{Code: 2, Err: fmt.Errorf(format, args...)}
}

// NewRootCmd constructs the raptix CLI. It performs no local stateful work;
// every command reads or changes state through the server API.
func NewRootCmd(stdout, stderr io.Writer) *cobra.Command {
	if stdout == nil {
		stdout = os.Stdout
	}
	if stderr == nil {
		stderr = os.Stderr
	}
	state := &commandState{
		server:  envOr("RAP_API_URL", defaultServer),
		token:   os.Getenv("RAP_API_TOKEN"),
		timeout: 30 * time.Second,
		stdout:  stdout,
		stderr:  stderr,
		http:    http.DefaultClient,
	}
	root := &cobra.Command{
		Use:           "raptix",
		Short:         "Raptix server client",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.SetOut(stdout)
	root.SetErr(stderr)
	root.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return invalidf("%v", err) })
	root.PersistentFlags().StringVar(&state.server, "server", state.server, "Raptix server URL (or RAP_API_URL)")
	root.PersistentFlags().StringVar(&state.server, "api-url", state.server, "alias for --server")
	root.PersistentFlags().StringVar(&state.token, "token", state.token, "API bearer token (or RAP_API_TOKEN)")
	root.PersistentFlags().DurationVar(&state.timeout, "timeout", state.timeout, "HTTP request timeout")
	root.PersistentFlags().BoolVar(&state.json, "json", false, "write API results as JSON")

	root.AddCommand(newRunCmd(state), newEvidenceCmd(state), newFindingCmd(state), newReportCmd(state), newCompletionCmd(root))
	return root
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func newRunCmd(state *commandState) *cobra.Command {
	run := &cobra.Command{Use: "run", Short: "Create, inspect, watch, or cancel runs"}
	run.AddCommand(newRunStartCmd(state), newRunWatchCmd(state), newRunStatusCmd(state), newRunCancelCmd(state))
	return run
}

func newRunStartCmd(state *commandState) *cobra.Command {
	var projectID, scopeID, name, profile, task string
	command := &cobra.Command{
		Use:   "start",
		Short: "Create a run and execute one agent attempt",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if err := required("--project", projectID); err != nil {
				return err
			}
			if err := required("--scope", scopeID); err != nil {
				return err
			}
			if err := required("--name", name); err != nil {
				return err
			}
			if err := required("--profile", profile); err != nil {
				return err
			}
			if err := required("--task", task); err != nil {
				return err
			}
			if err := validID("project", projectID); err != nil {
				return err
			}
			if err := validID("scope", scopeID); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				runKey, err := idempotencyKey()
				if err != nil {
					return err
				}
				run, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/projects/"+projectID+"/runs", map[string]string{"scopeId": scopeID, "name": name}, runKey)
				if err != nil {
					return err
				}
				var resource struct {
					ID string `json:"id"`
				}
				if err := json.Unmarshal(run, &resource); err != nil || resource.ID == "" {
					return fmt.Errorf("server returned an invalid run response")
				}
				agentKey, err := idempotencyKey()
				if err != nil {
					return err
				}
				agent, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/runs/"+resource.ID+"/agents", map[string]string{"profile": profile}, agentKey)
				if err != nil {
					return err
				}
				var agentResource struct {
					ID string `json:"id"`
				}
				if err := json.Unmarshal(agent, &agentResource); err != nil || agentResource.ID == "" {
					return fmt.Errorf("server returned an invalid agent response")
				}

				watchCtx, stopWatch := context.WithCancel(cmd.Context())
				watchDone := make(chan error, 1)
				go func() { watchDone <- client.Watch(watchCtx, resource.ID, "", progress(state.stderr, state.json)) }()
				attemptKey, err := idempotencyKey()
				if err == nil {
					var attempt json.RawMessage
					attempt, err = client.json(cmd.Context(), http.MethodPost, "/api/v1/agents/"+agentResource.ID+"/attempts", map[string]string{"task": task}, attemptKey)
					if err == nil {
						stopWatch()
						watchErr := <-watchDone
						if watchErr != nil {
							fmt.Fprintf(state.stderr, "progress stream ended: %v\n", watchErr)
						}
						return writeStart(state, run, agent, attempt)
					}
				}
				stopWatch()
				<-watchDone
				return err
			})
		},
	}
	command.Flags().StringVar(&projectID, "project", "", "project UUID")
	command.Flags().StringVar(&scopeID, "scope", "", "active scope UUID")
	command.Flags().StringVar(&name, "name", "", "run name")
	command.Flags().StringVar(&profile, "profile", "", "agent profile")
	command.Flags().StringVar(&task, "task", "", "agent task")
	return command
}

func newRunWatchCmd(state *commandState) *cobra.Command {
	var cursor string
	command := &cobra.Command{
		Use:   "watch RUN_ID",
		Short: "Stream run progress through SSE",
		Args:  exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("run", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				return client.Watch(cmd.Context(), args[0], cursor, progress(state.stderr, state.json))
			})
		},
	}
	command.Flags().StringVar(&cursor, "cursor", "", "resume after this SSE event ID")
	return command
}

func newRunStatusCmd(state *commandState) *cobra.Command {
	return getResourceCmd(state, "status RUN_ID", "Show current run status", "/api/v1/runs/")
}

func newRunCancelCmd(state *commandState) *cobra.Command {
	command := &cobra.Command{
		Use: "cancel RUN_ID", Short: "Request an idempotent run cancellation", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("run", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				data, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/runs/"+args[0]+"/cancel", nil, "")
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
	return command
}

func newEvidenceCmd(state *commandState) *cobra.Command {
	evidence := &cobra.Command{Use: "evidence", Short: "Read evidence metadata and content"}
	evidence.AddCommand(listResourceCmd(state, "list RUN_ID", "List evidence for a run", "/api/v1/runs/", "/evidence"))
	var content bool
	get := getResourceCmd(state, "get EVIDENCE_ID", "Show evidence metadata", "/api/v1/evidence/")
	get.RunE = func(cmd *cobra.Command, args []string) error {
		if err := validID("evidence", args[0]); err != nil {
			return err
		}
		if content && state.json {
			return invalidf("--content cannot be combined with --json")
		}
		return state.call(func(client *client) error {
			path := "/api/v1/evidence/" + args[0]
			if content {
				return client.content(cmd.Context(), path+"/content", state.stdout)
			}
			data, err := client.json(cmd.Context(), http.MethodGet, path, nil, "")
			if err != nil {
				return err
			}
			return writeResource(state, data)
		})
	}
	get.Flags().BoolVar(&content, "content", false, "write evidence content to stdout")
	evidence.AddCommand(get)
	return evidence
}

func newFindingCmd(state *commandState) *cobra.Command {
	finding := &cobra.Command{Use: "finding", Short: "Read, revise, and review findings"}
	finding.AddCommand(listResourceCmd(state, "list RUN_ID", "List findings for a run", "/api/v1/runs/", "/findings"))
	finding.AddCommand(getResourceCmd(state, "get FINDING_ID", "Show a finding", "/api/v1/findings/"))
	finding.AddCommand(newFindingRevisionsCmd(state), newFindingReviseCmd(state), newFindingReviewCmd(state))
	return finding
}

func newFindingRevisionsCmd(state *commandState) *cobra.Command {
	return &cobra.Command{
		Use: "revisions FINDING_ID", Short: "List immutable finding revisions", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("finding", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				data, err := client.json(cmd.Context(), http.MethodGet, "/api/v1/findings/"+args[0]+"/revisions", nil, "")
				if err != nil {
					return err
				}
				return writeList(state, data)
			})
		},
	}
}

func newFindingReviseCmd(state *commandState) *cobra.Command {
	var expectedVersion int
	var title, description, severity, confidence, reason string
	var evidence []string
	command := &cobra.Command{
		Use: "revise FINDING_ID", Short: "Record a new immutable finding revision", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("finding", args[0]); err != nil {
				return err
			}
			if expectedVersion <= 0 {
				return invalidf("--expected-version is required")
			}
			if err := required("--title", title); err != nil {
				return err
			}
			if err := required("--reason", reason); err != nil {
				return err
			}
			refs, err := parseEvidenceRefs(evidence)
			if err != nil {
				return err
			}
			return state.call(func(client *client) error {
				key, err := idempotencyKey()
				if err != nil {
					return err
				}
				body := map[string]any{
					"expectedVersion": expectedVersion, "title": title, "description": description,
					"severity": severity, "confidence": confidence, "evidence": refs, "reason": reason,
				}
				data, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/findings/"+args[0]+"/revisions", body, key)
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
	command.Flags().IntVar(&expectedVersion, "expected-version", 0, "current finding version (optimistic lock)")
	command.Flags().StringVar(&title, "title", "", "finding title")
	command.Flags().StringVar(&description, "description", "", "finding description")
	command.Flags().StringVar(&severity, "severity", "medium", "none|low|medium|high|critical")
	command.Flags().StringVar(&confidence, "confidence", "medium", "low|medium|high")
	command.Flags().StringArrayVar(&evidence, "evidence", nil, "evidence reference as EVIDENCE_ID:ROLE (repeatable)")
	command.Flags().StringVar(&reason, "reason", "", "why the revision is recorded")
	return command
}

func newFindingReviewCmd(state *commandState) *cobra.Command {
	var expectedVersion int
	var decision, reason string
	command := &cobra.Command{
		Use: "review FINDING_ID", Short: "Record a finding review decision", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("finding", args[0]); err != nil {
				return err
			}
			if expectedVersion <= 0 {
				return invalidf("--expected-version is required")
			}
			if err := required("--reason", reason); err != nil {
				return err
			}
			switch decision {
			case "reviewed", "confirmed", "rejected", "inconclusive":
			default:
				return invalidf("--decision must be reviewed, confirmed, rejected or inconclusive")
			}
			return state.call(func(client *client) error {
				key, err := idempotencyKey()
				if err != nil {
					return err
				}
				body := map[string]any{"expectedVersion": expectedVersion, "decision": decision, "reason": reason}
				data, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/findings/"+args[0]+"/reviews", body, key)
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
	command.Flags().IntVar(&expectedVersion, "expected-version", 0, "current finding version (optimistic lock)")
	command.Flags().StringVar(&decision, "decision", "", "reviewed|confirmed|rejected|inconclusive")
	command.Flags().StringVar(&reason, "reason", "", "review reason")
	return command
}

func newReportCmd(state *commandState) *cobra.Command {
	report := &cobra.Command{Use: "report", Short: "Create and read run reports"}
	report.AddCommand(newReportCreateCmd(state), newReportWatchCmd(state), newReportGetCmd(state))
	return report
}

func newReportCreateCmd(state *commandState) *cobra.Command {
	var templateID, templateVersion string
	command := &cobra.Command{
		Use: "create RUN_ID", Short: "Create the single report request for a run", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("run", args[0]); err != nil {
				return err
			}
			if err := required("--template-id", templateID); err != nil {
				return err
			}
			if err := required("--template-version", templateVersion); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				key, err := idempotencyKey()
				if err != nil {
					return err
				}
				body := map[string]string{"templateId": templateID, "templateVersion": templateVersion}
				data, err := client.json(cmd.Context(), http.MethodPost, "/api/v1/runs/"+args[0]+"/reports", body, key)
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
	command.Flags().StringVar(&templateID, "template-id", "default", "report template id")
	command.Flags().StringVar(&templateVersion, "template-version", "1", "report template version")
	return command
}

func newReportWatchCmd(state *commandState) *cobra.Command {
	var interval time.Duration
	command := &cobra.Command{
		Use: "watch REPORT_ID", Short: "Poll a report until it reaches a terminal state", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("report", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				ticker := time.NewTicker(interval)
				defer ticker.Stop()
				for {
					data, err := client.json(cmd.Context(), http.MethodGet, "/api/v1/reports/"+args[0], nil, "")
					if err != nil {
						return err
					}
					var report struct {
						Status string `json:"status"`
					}
					if err := json.Unmarshal(data, &report); err != nil {
						return err
					}
					fmt.Fprintf(state.stderr, "report %s\n", report.Status)
					switch report.Status {
					case "completed", "failed", "cancelled":
						return writeResource(state, data)
					}
					select {
					case <-cmd.Context().Done():
						return cmd.Context().Err()
					case <-ticker.C:
					}
				}
			})
		},
	}
	command.Flags().DurationVar(&interval, "interval", 2*time.Second, "poll interval")
	return command
}

func newReportGetCmd(state *commandState) *cobra.Command {
	var content bool
	command := &cobra.Command{
		Use: "get REPORT_ID", Short: "Show a report or write its content", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("report", args[0]); err != nil {
				return err
			}
			if content && state.json {
				return invalidf("--content cannot be combined with --json")
			}
			return state.call(func(client *client) error {
				if content {
					return client.content(cmd.Context(), "/api/v1/reports/"+args[0]+"/content", state.stdout)
				}
				data, err := client.json(cmd.Context(), http.MethodGet, "/api/v1/reports/"+args[0], nil, "")
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
	command.Flags().BoolVar(&content, "content", false, "write report Markdown to stdout")
	return command
}

func parseEvidenceRefs(values []string) ([]map[string]string, error) {
	refs := make([]map[string]string, 0, len(values))
	for _, value := range values {
		id, role, ok := strings.Cut(value, ":")
		if !ok {
			return nil, invalidf("--evidence %q must be EVIDENCE_ID:ROLE", value)
		}
		if _, err := uuid.Parse(id); err != nil {
			return nil, invalidf("--evidence %q has an invalid id", value)
		}
		refs = append(refs, map[string]string{"evidenceId": id, "role": role})
	}
	return refs, nil
}

func getResourceCmd(state *commandState, use, short, path string) *cobra.Command {
	return &cobra.Command{
		Use: use, Short: short, Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("resource", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				data, err := client.json(cmd.Context(), http.MethodGet, path+args[0], nil, "")
				if err != nil {
					return err
				}
				return writeResource(state, data)
			})
		},
	}
}

func listResourceCmd(state *commandState, use, short, prefix, suffix string) *cobra.Command {
	var limit int
	var cursor string
	command := &cobra.Command{
		Use: use, Short: short, Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validID("run", args[0]); err != nil {
				return err
			}
			return state.call(func(client *client) error {
				path := prefix + args[0] + suffix
				query := ""
				if limit > 0 {
					query = fmt.Sprintf("?limit=%d", limit)
				}
				if cursor != "" {
					separator := "?"
					if query != "" {
						separator = "&"
					}
					query += separator + "cursor=" + url.QueryEscape(cursor)
				}
				data, err := client.json(cmd.Context(), http.MethodGet, path+query, nil, "")
				if err != nil {
					return err
				}
				return writeList(state, data)
			})
		},
	}
	command.Flags().IntVar(&limit, "limit", 0, "page size (1-100)")
	command.Flags().StringVar(&cursor, "cursor", "", "list cursor")
	return command
}

func newCompletionCmd(root *cobra.Command) *cobra.Command {
	return &cobra.Command{
		Use: "completion [bash|zsh|fish]", Short: "Generate shell completion", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			switch args[0] {
			case "bash":
				return root.GenBashCompletion(cmd.OutOrStdout())
			case "zsh":
				return root.GenZshCompletion(cmd.OutOrStdout())
			case "fish":
				return root.GenFishCompletion(cmd.OutOrStdout(), true)
			default:
				return invalidf("unsupported shell %q (want bash, zsh, or fish)", args[0])
			}
		},
	}
}

func required(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return invalidf("%s is required", name)
	}
	return nil
}

func validID(name, value string) error {
	if _, err := uuid.Parse(value); err != nil {
		return invalidf("%s ID must be a UUID", name)
	}
	return nil
}

func exactArgs(want int) cobra.PositionalArgs {
	return func(_ *cobra.Command, args []string) error {
		if len(args) != want {
			return invalidf("expected %d argument(s), got %d", want, len(args))
		}
		return nil
	}
}

func idempotencyKey() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate idempotency key: %w", err)
	}
	return "cli-" + hex.EncodeToString(bytes), nil
}

func progress(output io.Writer, asJSON bool) func(Event) error {
	return func(event Event) error {
		if asJSON {
			data, err := json.Marshal(event)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(output, string(data))
			return err
		}
		_, err := fmt.Fprintf(output, "progress %s\n", event.Type)
		return err
	}
}

func writeStart(state *commandState, run, agent, attempt json.RawMessage) error {
	if state.json {
		return writeJSON(state.stdout, struct {
			Run     json.RawMessage `json:"run"`
			Agent   json.RawMessage `json:"agent"`
			Attempt json.RawMessage `json:"attempt"`
		}{run, agent, attempt})
	}
	for _, data := range []json.RawMessage{run, agent, attempt} {
		if err := writeSummary(state.stdout, data); err != nil {
			return err
		}
	}
	return nil
}

func writeResource(state *commandState, data json.RawMessage) error {
	if state.json {
		return writeJSON(state.stdout, data)
	}
	return writeSummary(state.stdout, data)
}

func writeList(state *commandState, data json.RawMessage) error {
	if state.json {
		return writeJSON(state.stdout, data)
	}
	var envelope struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	for _, item := range envelope.Items {
		if err := writeSummary(state.stdout, item); err != nil {
			return err
		}
	}
	return nil
}

func writeSummary(output io.Writer, data json.RawMessage) error {
	var resource struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Title   string `json:"title"`
		Status  string `json:"status"`
		Attempt struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"attempt"`
	}
	if err := json.Unmarshal(data, &resource); err != nil {
		return err
	}
	if resource.ID == "" && resource.Attempt.ID != "" {
		resource.ID, resource.Status = resource.Attempt.ID, resource.Attempt.Status
	}
	label := resource.Name
	if label == "" {
		label = resource.Title
	}
	_, err := fmt.Fprintf(output, "%s\t%s\t%s\n", resource.ID, resource.Status, label)
	return err
}

func writeJSON(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

// Package builtin implements capabilities that run inside the application
// process. Each capability records its own output as evidence through an
// injected EvidenceWriter; a capability never decides its own permission, which
// is checked by execution/governance before it is dispatched.
package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

// EvidenceWriter records an artifact's bytes through workspace/evidence.
type EvidenceWriter interface {
	Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error)
}

// HTTPProbe performs a single HTTP request and records the raw response as
// evidence. It is the Phase 4 reference capability: deterministic, no sandbox,
// easy to exercise success and error paths.
type HTTPProbe struct {
	client *http.Client
	writer EvidenceWriter
	max    int64
}

// NewHTTPProbe wires the probe with an HTTP client timeout and an output cap.
func NewHTTPProbe(w EvidenceWriter, timeout time.Duration, maxOutputBytes int64) *HTTPProbe {
	return &HTTPProbe{
		client: &http.Client{Timeout: timeout},
		writer: w,
		max:    maxOutputBytes,
	}
}

type probeArgs struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
}

// Invoke executes the probe. It returns an output.Result whose RawRef points at
// the recorded evidence artifact (empty when the capability was not attempted).
func (h *HTTPProbe) Invoke(ctx context.Context, raw json.RawMessage) (*output.Result, error) {
	var args probeArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return output.Error("", fmt.Errorf("invalid http_probe args: %w", err)), nil
	}
	url := strings.TrimSpace(args.URL)
	if url == "" {
		return output.Error("", fmt.Errorf("http_probe url is required")), nil
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return output.Error("", fmt.Errorf("http_probe url must use http or https")), nil
	}
	method := strings.ToUpper(strings.TrimSpace(args.Method))
	if method == "" {
		method = "GET"
	}

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return output.Error("", fmt.Errorf("build http request: %w", err)), nil
	}
	for k, v := range args.Headers {
		req.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := h.client.Do(req)
	if err != nil {
		// Cover both the caller's context deadline and the client's own timeout
		// (http.Client.Timeout surfaces as a wrapped context.DeadlineExceeded).
		if ctx.Err() == context.DeadlineExceeded || errors.Is(err, context.DeadlineExceeded) {
			return output.Timeout("", err), nil
		}
		return output.Error("", err), nil
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, h.max+1))
	if err != nil {
		return output.Error("", fmt.Errorf("read http response: %w", err)), nil
	}
	elapsed := time.Since(start).Milliseconds()

	// Record the raw HTTP response (status line + headers + truncated body) as
	// the artifact so later review has the actual bytes behind the call.
	rawResponse := renderRawResponse(resp, body)
	art, err := h.writer.Register(ctx, evidence.RegisterParams{
		Kind:          evidence.KindRaw,
		MIME:          "text/plain",
		Sensitivity:   evidence.SensitivityLow,
		SchemaVersion: "http-response/1.0",
	}, bytes.NewReader([]byte(rawResponse)))
	if err != nil {
		return output.Error("", fmt.Errorf("record evidence: %w", err)), nil
	}

	res := output.Success(art.ID.String(), "", "")
	res.DurationMs = elapsed
	return res, nil
}

// renderRawResponse reconstructs a text form of the HTTP response for evidence.
func renderRawResponse(resp *http.Response, body []byte) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s\r\n", resp.Proto, resp.Status)
	for k, vv := range resp.Header {
		for _, v := range vv {
			fmt.Fprintf(&b, "%s: %s\r\n", k, v)
		}
	}
	b.WriteString("\r\n")
	b.Write(body)
	return b.String()
}

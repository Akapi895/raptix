// Package cli implements the terminal client for the Raptix HTTP API.
package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 4 << 20

// ClientError is an unsuccessful HTTP response returned by the API.
type ClientError struct {
	Status int
	Code   string
	Detail string
}

func (e *ClientError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("server returned HTTP %d", e.Status)
	}
	return fmt.Sprintf("server returned HTTP %d (%s): %s", e.Status, e.Code, e.Detail)
}

type client struct {
	baseURL *url.URL
	token   string
	http    *http.Client
	timeout time.Duration
}

func newClient(rawURL, token string, timeout time.Duration, httpClient *http.Client) (*client, error) {
	baseURL, err := url.Parse(rawURL)
	if err != nil || baseURL.Scheme == "" || baseURL.Host == "" {
		return nil, fmt.Errorf("server must be an absolute HTTP URL")
	}
	if baseURL.Scheme != "http" && baseURL.Scheme != "https" {
		return nil, fmt.Errorf("server URL scheme must be http or https")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("API token is required (set --token or RAP_API_TOKEN)")
	}
	if timeout <= 0 {
		return nil, fmt.Errorf("timeout must be positive")
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &client{baseURL: baseURL, token: token, http: httpClient, timeout: timeout}, nil
}

func (c *client) endpoint(path string) string {
	u := *c.baseURL
	path, query, _ := strings.Cut(path, "?")
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawPath = ""
	u.RawQuery = query
	return u.String()
}

func (c *client) request(ctx context.Context, method, path string, body []byte, idempotencyKey string, stream bool) (*http.Response, error) {
	requestCtx := ctx
	var cancel context.CancelFunc
	if !stream {
		requestCtx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}

	attempts := 1
	if idempotencyKey != "" {
		// A retry retains the same key and payload, so the server can safely
		// return the original outcome when a response was lost in transit.
		attempts = 2
	}
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		req, err := http.NewRequestWithContext(requestCtx, method, c.endpoint(path), bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		if stream {
			req.Header.Set("Accept", "text/event-stream")
		} else {
			req.Header.Set("Accept", "application/json")
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if idempotencyKey != "" {
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}
		resp, err := c.http.Do(req)
		if err == nil {
			return resp, nil
		}
		if requestCtx.Err() != nil {
			return nil, requestCtx.Err()
		}
		lastErr = err
	}
	return nil, lastErr
}

func (c *client) json(ctx context.Context, method, path string, request any, idempotencyKey string) (json.RawMessage, error) {
	var body []byte
	var err error
	if request != nil {
		body, err = json.Marshal(request)
		if err != nil {
			return nil, err
		}
	}
	resp, err := c.request(ctx, method, path, body, idempotencyKey, false)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, problem(resp.StatusCode, data)
	}
	return json.RawMessage(data), nil
}

func (c *client) content(ctx context.Context, path string, output io.Writer) error {
	resp, err := c.request(ctx, http.MethodGet, path, nil, "", false)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if readErr != nil {
			return readErr
		}
		return problem(resp.StatusCode, data)
	}
	_, err = io.Copy(output, resp.Body)
	return err
}

func problem(status int, data []byte) error {
	var body struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(data, &body); err != nil || body.Detail == "" {
		body.Detail = strings.TrimSpace(string(data))
	}
	if body.Detail == "" {
		body.Detail = http.StatusText(status)
	}
	return &ClientError{Status: status, Code: body.Code, Detail: body.Detail}
}

// Event is one event from the run SSE stream. Event data remains opaque to
// the CLI because HTTP resources, rather than SSE, are authoritative state.
type Event struct {
	ID   string          `json:"id,omitempty"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func (c *client) streamOnce(ctx context.Context, runID, cursor string, receive func(Event) error) error {
	if cursor != "" {
		return c.streamWithCursor(ctx, runID, cursor, receive)
	}
	resp, err := c.request(ctx, http.MethodGet, "/api/v1/runs/"+runID+"/events", nil, "", true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if readErr != nil {
			return readErr
		}
		return problem(resp.StatusCode, data)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return fmt.Errorf("server returned %q for event stream", resp.Header.Get("Content-Type"))
	}

	return parseSSE(resp.Body, receive)
}

func (c *client) streamWithCursor(ctx context.Context, runID, cursor string, receive func(Event) error) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("/api/v1/runs/"+runID+"/events"), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Last-Event-ID", cursor)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if readErr != nil {
			return readErr
		}
		return problem(resp.StatusCode, data)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return fmt.Errorf("server returned %q for event stream", resp.Header.Get("Content-Type"))
	}
	return parseSSE(resp.Body, receive)
}

func parseSSE(reader io.Reader, receive func(Event) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxResponseBytes)
	event := Event{Type: "message"}
	var data []string
	emit := func() error {
		if len(data) == 0 {
			return nil
		}
		event.Data = json.RawMessage(strings.Join(data, "\n"))
		if err := receive(event); err != nil {
			return err
		}
		event = Event{Type: "message"}
		data = nil
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := emit(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "id":
			event.ID = value
		case "event":
			event.Type = value
		case "data":
			data = append(data, value)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.EOF
}

// Watch reconnects after a clean stream close, retaining the last server event
// ID. A restarted server responds with its contract-defined snapshot event.
func (c *client) Watch(ctx context.Context, runID, cursor string, receive func(Event) error) error {
	lastID := cursor
	for {
		err := c.streamOnce(ctx, runID, lastID, func(event Event) error {
			if event.ID != "" {
				lastID = event.ID
			}
			return receive(event)
		})
		if ctx.Err() != nil {
			return nil
		}
		if !errors.Is(err, io.EOF) {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(200 * time.Millisecond):
		}
	}
}

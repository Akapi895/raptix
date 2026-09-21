package eino

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

func TestNewRequiresConfig(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{"empty base url", Config{BaseURL: "", APIKey: "x", DefaultModel: "m"}},
		{"invalid base url", Config{BaseURL: "not-a-url", APIKey: "x", DefaultModel: "m"}},
		{"empty api key", Config{BaseURL: "http://x", DefaultModel: "m"}},
		{"empty model", Config{BaseURL: "http://x", APIKey: "x", DefaultModel: ""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.cfg); err == nil {
				t.Error("expected config validation error")
			}
		})
	}
	// valid config, no network required at construction
	if _, err := New(Config{BaseURL: "http://localhost:1", APIKey: "k", DefaultModel: "m"}); err != nil {
		t.Errorf("New(valid): %v", err)
	}
}

func TestDefaultTimeout(t *testing.T) {
	_, err := New(Config{BaseURL: "http://localhost:1", APIKey: "k", DefaultModel: "m"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestChatUsesOverrideModelAndMapsResponse(t *testing.T) {
	server := openAIStub(t, func(w http.ResponseWriter, r *http.Request, request map[string]any) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %q, want /chat/completions", r.URL.Path)
		}
		if got := request["model"]; got != "override-model" {
			t.Errorf("request model = %v, want override-model", got)
		}
		if got, ok := request["stream"]; ok && got != false {
			t.Errorf("request stream = %v, want false when present", got)
		}
		fmt.Fprint(w, `{"id":"chat-1","object":"chat.completion","created":1,"model":"override-model","choices":[{"index":0,"message":{"role":"assistant","content":"complete reply"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)
	})
	defer server.Close()

	model := newStubModel(t, server.URL)
	response, err := model.Chat(context.Background(), &llm.ChatRequest{
		Model:    "override-model",
		Messages: []llm.ChatMessage{{Role: llm.RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if response.Content != "complete reply" {
		t.Errorf("content = %q", response.Content)
	}
	if response.Usage != (llm.Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}) {
		t.Errorf("usage = %+v", response.Usage)
	}
}

func TestChatReturnsProviderError(t *testing.T) {
	server := openAIStub(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"error":{"message":"rate limit exceeded","type":"rate_limit_error"}}`)
	})
	defer server.Close()

	_, err := newStubModel(t, server.URL).Chat(context.Background(), testRequest())
	if err == nil {
		t.Fatal("Chat returned nil error")
	}
	if !strings.Contains(err.Error(), "model generate") || !strings.Contains(err.Error(), "rate limit exceeded") {
		t.Errorf("Chat error = %v", err)
	}
}

func TestStreamMapsTerminalChunkAndUsage(t *testing.T) {
	server := openAIStub(t, func(w http.ResponseWriter, _ *http.Request, request map[string]any) {
		if got := request["stream"]; got != true {
			t.Errorf("request stream = %v, want true", got)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"stream-1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"default-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hello\"},\"finish_reason\":null}]}\n\n")
		fmt.Fprint(w, "data: {\"id\":\"stream-1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"default-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"!\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	})
	defer server.Close()

	stream, err := newStubModel(t, server.URL).Stream(context.Background(), testRequest())
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	defer stream.Close()

	first, err := stream.Recv()
	if err != nil {
		t.Fatalf("first Recv: %v", err)
	}
	if first.Content != "hello" || first.Finished || first.Usage != nil {
		t.Errorf("first chunk = %+v", first)
	}
	terminal, err := stream.Recv()
	if err != nil {
		t.Fatalf("terminal Recv: %v", err)
	}
	if terminal.Content != "!" || !terminal.Finished || terminal.FinishReason != "stop" {
		t.Errorf("terminal chunk = %+v", terminal)
	}
	if terminal.Usage == nil || *terminal.Usage != (llm.Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}) {
		t.Errorf("terminal usage = %+v", terminal.Usage)
	}
	if _, err := stream.Recv(); !errors.Is(err, llm.ErrStreamEnd) {
		t.Errorf("Recv after terminal error = %v, want ErrStreamEnd", err)
	}
}

func TestStreamSynthesizesTerminalChunkAtEOF(t *testing.T) {
	server := openAIStub(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"stream-2\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"default-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":1,\"total_tokens\":5}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	})
	defer server.Close()

	stream, err := newStubModel(t, server.URL).Stream(context.Background(), testRequest())
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	defer stream.Close()
	if chunk, err := stream.Recv(); err != nil || chunk.Content != "partial" || chunk.Finished {
		t.Fatalf("content Recv = %+v, %v", chunk, err)
	}
	terminal, err := stream.Recv()
	if err != nil {
		t.Fatalf("EOF terminal Recv: %v", err)
	}
	if !terminal.Finished || terminal.FinishReason != "" || terminal.Usage == nil || *terminal.Usage != (llm.Usage{PromptTokens: 4, CompletionTokens: 1, TotalTokens: 5}) {
		t.Errorf("EOF terminal chunk = %+v", terminal)
	}
	if _, err := stream.Recv(); !errors.Is(err, llm.ErrStreamEnd) {
		t.Errorf("Recv after EOF terminal error = %v, want ErrStreamEnd", err)
	}
}

func newStubModel(t *testing.T, baseURL string) llm.Model {
	t.Helper()
	model, err := New(Config{BaseURL: baseURL, APIKey: "test-key", DefaultModel: "default-model"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return model
}

func testRequest() *llm.ChatRequest {
	return &llm.ChatRequest{Messages: []llm.ChatMessage{{Role: llm.RoleUser, Content: "hello"}}}
}

func openAIStub(t *testing.T, handler func(http.ResponseWriter, *http.Request, map[string]any)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		defer r.Body.Close()
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			t.Errorf("decode request: %v", err)
		}
		handler(w, r, request)
	}))
}

// TestLiveProviderChatAndStream is an opt-in integration test against the VTNet
// endpoint. Set RAP_TEST_LLM_API_KEY to run it; it never runs in CI without a key.
func TestLiveProviderChatAndStream(t *testing.T) {
	key := os.Getenv("RAP_TEST_LLM_API_KEY")
	if key == "" {
		t.Skip("set RAP_TEST_LLM_API_KEY to run live provider test")
	}
	m, err := New(Config{
		BaseURL:      envOr("RAP_TEST_LLM_BASE_URL", "https://stream-netmind.viettel.vn/aigw/ai/v1"),
		APIKey:       key,
		Timeout:      30 * time.Second,
		DefaultModel: envOr("RAP_TEST_LLM_MODEL", "MiniMax/MiniMax-M3-VIP"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if m == nil {
		t.Fatal("model is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	req := &llm.ChatRequest{
		Model:    "",
		Messages: []llm.ChatMessage{{Role: llm.RoleUser, Content: "Reply with exactly: ok"}},
	}
	resp, err := m.Chat(ctx, req)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	t.Logf("chat response: %q", resp.Content)
	if resp.Content == "" {
		t.Error("empty chat response")
	}

	sr, err := m.Stream(ctx, req)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	defer sr.Close()
	var got string
	streamErr := error(nil)
	for {
		ch, err := sr.Recv()
		if errors.Is(err, llm.ErrStreamEnd) {
			break
		}
		if err != nil {
			streamErr = err
			break
		}
		got += ch.Content
	}
	if streamErr != nil {
		t.Fatalf("Stream recv: %v", streamErr)
	}
	t.Logf("stream response: %q", got)
	if got == "" {
		t.Error("empty stream response")
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

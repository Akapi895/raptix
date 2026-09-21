package llm

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeReader struct {
	chunks []string
	idx    int
}

func (f *fakeReader) Recv() (*StreamChunk, error) {
	if f.idx >= len(f.chunks) {
		return nil, ErrStreamEnd
	}
	c := f.chunks[f.idx]
	f.idx++
	u := &Usage{PromptTokens: 5, CompletionTokens: f.idx, TotalTokens: 5 + f.idx}
	return &StreamChunk{Content: c, Usage: u}, nil
}

func (f *fakeReader) Close() error { return nil }

type fakeModel struct{}

func (fakeModel) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	if req == nil {
		return nil, errors.New("nil request")
	}
	return &ChatResponse{Content: "hello", Usage: Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2}}, nil
}

func (fakeModel) Stream(ctx context.Context, req *ChatRequest) (StreamReader, error) {
	return &fakeReader{chunks: []string{"hel", "lo"}}, nil
}

func TestChatContract(t *testing.T) {
	m := fakeModel{}
	resp, err := m.Chat(context.Background(), &ChatRequest{Messages: []ChatMessage{{Role: RoleUser, Content: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != "hello" {
		t.Errorf("content = %q", resp.Content)
	}
	if resp.Usage.TotalTokens != 2 {
		t.Errorf("total = %d", resp.Usage.TotalTokens)
	}
}

func TestStreamContract(t *testing.T) {
	m := fakeModel{}
	sr, err := m.Stream(context.Background(), &ChatRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sr.Close()
	var b strings.Builder
	for {
		ch, err := sr.Recv()
		if errors.Is(err, ErrStreamEnd) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b.WriteString(ch.Content)
	}
	if b.String() != "hello" {
		t.Errorf("streamed = %q, want hello", b.String())
	}
}

func TestValidateRequest(t *testing.T) {
	temperature := float32(2.1)
	maxTokens := 0
	for _, req := range []*ChatRequest{
		nil,
		{},
		{Messages: []ChatMessage{{Role: "tool", Content: "x"}}},
		{Messages: []ChatMessage{{Role: RoleUser}}},
		{Messages: []ChatMessage{{Role: RoleUser, Content: "x"}}, Temperature: &temperature},
		{Messages: []ChatMessage{{Role: RoleUser, Content: "x"}}, MaxTokens: &maxTokens},
	} {
		if err := ValidateRequest(req); err == nil {
			t.Error("expected invalid request error")
		}
	}
	if err := ValidateRequest(&ChatRequest{Messages: []ChatMessage{{Role: RoleUser, Content: "x"}}}); err != nil {
		t.Fatalf("valid request: %v", err)
	}
}

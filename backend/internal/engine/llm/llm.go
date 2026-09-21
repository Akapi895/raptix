// Package llm defines the business-owned contract for model calls and
// streaming. It intentionally holds no framework types: Eino (or any other
// provider) is mapped into this contract behind an adapter, so model
// integration never leaks into evidence, findings, state or reporting.
package llm

import (
	"context"
	"errors"
	"fmt"
)

// Role is the speaker of a chat message.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// ChatMessage is one turn of a conversation.
type ChatMessage struct {
	Role    Role
	Content string
}

// Usage reports token accounting for a completion.
type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// ChatRequest is a single model call request.
type ChatRequest struct {
	Model       string
	Messages    []ChatMessage
	Temperature *float32
	MaxTokens   *int
}

// ChatResponse is a single non-streamed model reply.
type ChatResponse struct {
	Content string
	Usage   Usage
}

// StreamChunk is one incremental piece of a streamed reply. Finished marks the
// terminal chunk that carries total usage.
type StreamChunk struct {
	Content      string
	Usage        *Usage
	FinishReason string
	Finished     bool
}

// ErrStreamEnd is returned by StreamReader.Recv to signal the stream ended.
var ErrStreamEnd = errors.New("stream ended")

// StreamReader yields chunks until ErrStreamEnd, then must be closed.
type StreamReader interface {
	Recv() (*StreamChunk, error)
	Close() error
}

// Model is the business contract for model calls. Implementations (e.g. the
// Eino adapter) expose Chat and Stream; the caller selects the model id via the
// request.
type Model interface {
	Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error)
	Stream(ctx context.Context, req *ChatRequest) (StreamReader, error)
}

// ValidateRequest rejects values that cannot be represented consistently by
// model providers. Adapters call it before constructing provider messages.
func ValidateRequest(req *ChatRequest) error {
	if req == nil {
		return fmt.Errorf("chat request is nil")
	}
	if len(req.Messages) == 0 {
		return fmt.Errorf("chat request has no messages")
	}
	for i, message := range req.Messages {
		switch message.Role {
		case RoleSystem, RoleUser, RoleAssistant:
		default:
			return fmt.Errorf("message %d has invalid role %q", i, message.Role)
		}
		if message.Content == "" {
			return fmt.Errorf("message %d has empty content", i)
		}
	}
	if req.Temperature != nil && (*req.Temperature < 0 || *req.Temperature > 2) {
		return fmt.Errorf("temperature must be between 0 and 2")
	}
	if req.MaxTokens != nil && *req.MaxTokens <= 0 {
		return fmt.Errorf("max tokens must be positive")
	}
	return nil
}

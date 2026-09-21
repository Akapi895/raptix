// Package eino adapts Eino's OpenAI-compatible chat model to the business
// llm.Model contract. It is the only place that imports Eino; model types and
// topology never leak into other packages.
package eino

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sync"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	einoModel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"

	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

// Config configures the OpenAI-compatible provider (e.g. VTNet NetMind).
type Config struct {
	BaseURL      string
	APIKey       string
	Timeout      time.Duration
	DefaultModel string
}

// adapter implements llm.Model over Eino's openai chat model.
type adapter struct {
	cfg     Config
	mu      sync.Mutex
	clients map[string]*openai.ChatModel
}

// New builds a model adapter for the configured provider. The client is created
// lazily per model id so several models on the same base URL can be used.
func New(cfg Config) (llm.Model, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("eino adapter: base_url is required")
	}
	u, err := url.ParseRequestURI(cfg.BaseURL)
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("eino adapter: base_url must be an absolute http(s) URL")
	}
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("eino adapter: api_key is required")
	}
	if cfg.DefaultModel == "" {
		return nil, fmt.Errorf("eino adapter: default model is required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 60 * time.Second
	}
	return &adapter{cfg: cfg, clients: map[string]*openai.ChatModel{}}, nil
}

func (a *adapter) client(model string) (*openai.ChatModel, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if model == "" {
		model = a.cfg.DefaultModel
	}
	if c, ok := a.clients[model]; ok {
		return c, nil
	}
	c, err := openai.NewChatModel(context.Background(), &openai.ChatModelConfig{
		BaseURL: a.cfg.BaseURL,
		APIKey:  a.cfg.APIKey,
		Model:   model,
		Timeout: a.cfg.Timeout,
	})
	if err != nil {
		return nil, fmt.Errorf("create eino chat model for %q: %w", model, err)
	}
	a.clients[model] = c
	return c, nil
}

// Chat maps a request to Eino, waits for a complete reply and maps it back.
func (a *adapter) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.ChatResponse, error) {
	if err := llm.ValidateRequest(req); err != nil {
		return nil, err
	}
	c, err := a.client(req.Model)
	if err != nil {
		return nil, err
	}
	msgs := make([]*schema.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		msgs = append(msgs, toEinoMessage(m))
	}
	var opts []einoModel.Option
	if req.Temperature != nil {
		opts = append(opts, einoModel.WithTemperature(*req.Temperature))
	}
	if req.MaxTokens != nil {
		opts = append(opts, einoModel.WithMaxTokens(*req.MaxTokens))
	}
	out, err := c.Generate(ctx, msgs, opts...)
	if err != nil {
		return nil, fmt.Errorf("model generate: %w", err)
	}
	return &llm.ChatResponse{
		Content: out.Content,
		Usage:   toUsage(out.ResponseMeta),
	}, nil
}

// Stream maps a request to Eino and returns a business stream reader.
func (a *adapter) Stream(ctx context.Context, req *llm.ChatRequest) (llm.StreamReader, error) {
	if err := llm.ValidateRequest(req); err != nil {
		return nil, err
	}
	c, err := a.client(req.Model)
	if err != nil {
		return nil, err
	}
	msgs := make([]*schema.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		msgs = append(msgs, toEinoMessage(m))
	}
	var opts []einoModel.Option
	if req.Temperature != nil {
		opts = append(opts, einoModel.WithTemperature(*req.Temperature))
	}
	if req.MaxTokens != nil {
		opts = append(opts, einoModel.WithMaxTokens(*req.MaxTokens))
	}
	sr, err := c.Stream(ctx, msgs, opts...)
	if err != nil {
		return nil, fmt.Errorf("model stream: %w", err)
	}
	return &streamReader{sr: sr}, nil
}

// streamReader adapts Eino's schema.StreamReader to llm.StreamReader.
type streamReader struct {
	sr           *schema.StreamReader[*schema.Message]
	lastUsage    *llm.Usage
	terminalSent bool
}

func (s *streamReader) Recv() (*llm.StreamChunk, error) {
	chunk, err := s.sr.Recv()
	if err != nil {
		if errors.Is(err, io.EOF) {
			if !s.terminalSent {
				s.terminalSent = true
				return &llm.StreamChunk{Usage: s.lastUsage, Finished: true}, nil
			}
			return nil, llm.ErrStreamEnd
		}
		return nil, err
	}
	usage := usagePtr(chunk.ResponseMeta)
	if usage != nil {
		s.lastUsage = usage
	}
	finishReason := ""
	if chunk.ResponseMeta != nil {
		finishReason = chunk.ResponseMeta.FinishReason
	}
	finished := finishReason != ""
	if finished {
		s.terminalSent = true
		if usage == nil {
			usage = s.lastUsage
		}
	}
	return &llm.StreamChunk{
		Content:      chunk.Content,
		Usage:        usage,
		FinishReason: finishReason,
		Finished:     finished,
	}, nil
}

func (s *streamReader) Close() error {
	s.sr.Close()
	return nil
}

func toEinoMessage(m llm.ChatMessage) *schema.Message {
	return &schema.Message{Role: toEinoRole(m.Role), Content: m.Content}
}

func toEinoRole(r llm.Role) schema.RoleType {
	switch r {
	case llm.RoleSystem:
		return schema.System
	case llm.RoleAssistant:
		return schema.Assistant
	default:
		return schema.User
	}
}

func toUsage(meta *schema.ResponseMeta) llm.Usage {
	if meta == nil || meta.Usage == nil {
		return llm.Usage{}
	}
	u := meta.Usage
	return llm.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

func usagePtr(meta *schema.ResponseMeta) *llm.Usage {
	if meta == nil || meta.Usage == nil {
		return nil
	}
	u := toUsage(meta)
	return &u
}

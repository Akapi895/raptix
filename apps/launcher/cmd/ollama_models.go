package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ollamaProbeClient is the HTTP client for onboard-time model
// discovery. Tests swap it via withOllamaProbeClient.
var ollamaProbeClient = &http.Client{Timeout: 1500 * time.Millisecond}

// ollamaProbeMaxBody limits response reads from Ollama or its proxy.
const ollamaProbeMaxBody = 2 << 20 // 2 MiB

// ollamaProbeResult distinguishes an unreachable server from one with no tool-capable models.
type ollamaProbeResult struct {
	Reachable         bool
	ToolCapableModels []string
}

// probeOllamaForOnboard uses the first host URL that answers /api/tags, then probes its models in parallel.
func probeOllamaForOnboard(baseURL string) ollamaProbeResult {
	for _, candidate := range candidateProbeURLs(baseURL) {
		models, ok := fetchOllamaTags(candidate)
		if !ok {
			continue
		}
		return ollamaProbeResult{
			Reachable:         true,
			ToolCapableModels: filterToolCapable(candidate, models),
		}
	}
	return ollamaProbeResult{}
}

// filterToolCapable checks /api/show in parallel to stay within the onboarding timeout.
func filterToolCapable(baseURL string, models []string) []string {
	results := make([]bool, len(models))
	var wg sync.WaitGroup
	for i, m := range models {
		wg.Add(1)
		go func(i int, m string) {
			defer wg.Done()
			results[i] = hasOllamaToolsCapability(baseURL, m)
		}(i, m)
	}
	wg.Wait()
	capable := make([]string, 0, len(models))
	for i, ok := range results {
		if ok {
			capable = append(capable, models[i])
		}
	}
	return capable
}

type ollamaTag struct {
	Name string `json:"name"`
}

type ollamaTagsResponse struct {
	Models []ollamaTag `json:"models"`
}

type ollamaShowResponse struct {
	Capabilities []string `json:"capabilities"`
}

// fetchOllamaTags distinguishes an empty model list from an unreachable server.
func fetchOllamaTags(baseURL string) ([]string, bool) {
	resp, err := ollamaProbeClient.Get(strings.TrimRight(baseURL, "/") + "/api/tags")
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, ollamaProbeMaxBody))
	if err != nil {
		return nil, false
	}
	var data ollamaTagsResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, false
	}
	out := make([]string, 0, len(data.Models))
	for _, m := range data.Models {
		if name := strings.TrimSpace(m.Name); name != "" {
			out = append(out, name)
		}
	}
	return out, true
}

// hasOllamaToolsCapability requires an explicit tools capability in /api/show.
func hasOllamaToolsCapability(baseURL, model string) bool {
	payload, err := json.Marshal(map[string]string{"name": model})
	if err != nil {
		return false
	}
	resp, err := ollamaProbeClient.Post(
		strings.TrimRight(baseURL, "/")+"/api/show",
		"application/json",
		bytes.NewReader(payload),
	)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, ollamaProbeMaxBody))
	if err != nil {
		return false
	}
	var data ollamaShowResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return false
	}
	for _, c := range data.Capabilities {
		if c == "tools" {
			return true
		}
	}
	return false
}

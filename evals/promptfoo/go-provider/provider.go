// Package main implements a promptfoo custom provider that calls the project's
// LLM (DeepSeek, an OpenAI-compatible Chat Completions API).
//
// It is the Go equivalent of the TypeScript chat path in lib/chat-llm.ts:
// same RAG-tutor system prompt and the same temperature (0.2). Everything
// configurable (model, baseUrl, temperature, system prompt) is read from the
// `config` block of the provider in promptfooconfig.yaml so the same binary
// can target any OpenAI-compatible endpoint.
//
// Standard library only — no third-party modules — so promptfoo can build it
// in its temp dir without needing a go.sum or module download at eval time.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// systemPrompt mirrors lib/chat-llm.ts SYSTEM_PROMPT — keep in sync.
const systemPrompt = "You are an AI engineering tutor for a knowledge base covering transformers, RAG, agents, fine-tuning, evaluations, infrastructure, safety, and multimodal AI. Answer questions concisely and accurately. Cite specific architectures or lesson topics when relevant. When context excerpts are provided, base your answer on them and cite the lesson title. If a question is outside AI/ML engineering, politely redirect the conversation back to the subject matter."

const (
	defaultBaseURL     = "https://api.deepseek.com/v1"
	defaultModel       = "deepseek-chat"
	defaultTemperature = 0.2
	defaultAPIKeyEnv   = "DEEPSEEK_API_KEY"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	Stream      bool          `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// cfg pulls the provider `config` block out of the options promptfoo passes in.
func cfg(options map[string]interface{}) map[string]interface{} {
	if c, ok := options["config"].(map[string]interface{}); ok {
		return c
	}
	return map[string]interface{}{}
}

func cfgString(c map[string]interface{}, key, def string) string {
	if v, ok := c[key].(string); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func cfgFloat(c map[string]interface{}, key string, def float64) float64 {
	if v, ok := c[key].(float64); ok {
		return v
	}
	return def
}

// CallApi is the entry point promptfoo invokes for each test row.
func CallApi(prompt string, options map[string]interface{}, ctx map[string]interface{}) (map[string]interface{}, error) {
	c := cfg(options)

	baseURL := strings.TrimRight(cfgString(c, "baseUrl", defaultBaseURL), "/")
	model := cfgString(c, "model", defaultModel)
	temperature := cfgFloat(c, "temperature", defaultTemperature)
	sysPrompt := cfgString(c, "systemPrompt", systemPrompt)
	apiKeyEnv := cfgString(c, "apiKeyEnv", defaultAPIKeyEnv)

	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("missing API key: set %s in the environment", apiKeyEnv)
	}

	reqBody := chatRequest{
		Model:       model,
		Temperature: temperature,
		Stream:      false,
		Messages: []chatMessage{
			{Role: "system", Content: sysPrompt},
			{Role: "user", Content: prompt},
		},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chat completion request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	var parsed chatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parse response (status %d): %v; body: %s", resp.StatusCode, err, truncate(string(raw), 500))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if parsed.Error != nil {
			return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, parsed.Error.Message)
		}
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, truncate(string(raw), 500))
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("no choices returned: %s", truncate(string(raw), 500))
	}

	return map[string]interface{}{
		"output": parsed.Choices[0].Message.Content,
		"tokenUsage": map[string]interface{}{
			"prompt":     parsed.Usage.PromptTokens,
			"completion": parsed.Usage.CompletionTokens,
			"total":      parsed.Usage.TotalTokens,
		},
	}, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// main is required for `go run` / build, but promptfoo calls CallApi directly.
func main() {}

# Promptfoo eval — custom Go provider

Evaluates the roadmap's tutor LLM (DeepSeek, OpenAI-compatible) through a
**custom Go provider** instead of a JavaScript one.

```
evals/promptfoo/
├── promptfooconfig.yaml     # prompts, provider, tests/assertions
├── prompts/answer.txt       # user prompt template ({{question}})
└── go-provider/
    ├── go.mod               # stdlib-only module (no go.sum needed)
    └── provider.go          # CallApi → DeepSeek /chat/completions
```

## How it works

promptfoo builds `go-provider/provider.go` in a temp dir and calls its
`CallApi(prompt, options, ctx)` function for each test row. The provider is a
Go port of the chat path in `lib/chat-llm.ts`: same tutor system prompt and
`temperature: 0.2`. Model, `baseUrl`, `temperature`, `systemPrompt`, and
`apiKeyEnv` are all overridable from the `config:` block in the YAML, so the
same binary can target any OpenAI-compatible endpoint.

It uses only the Go standard library, so promptfoo can compile it without a
module download (`go.sum`) at eval time.

## Run

Requires `go` on PATH and `DEEPSEEK_API_KEY` in the environment.

```bash
cd evals/promptfoo
export DEEPSEEK_API_KEY=...        # or: set -a; source ../../../../.env; set +a
npx -y promptfoo@latest eval       # add -v for verbose output
npx -y promptfoo@latest view       # open the results UI
```

The `llm-rubric` assertions are graded by DeepSeek too (see `defaultTest` in
the YAML), so the only secret needed is `DEEPSEEK_API_KEY`.

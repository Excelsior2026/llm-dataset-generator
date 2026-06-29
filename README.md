# LLM Dataset Generator

A local-first LLM training dataset generator with multi-provider model gateway and Electron desktop app.

## Features

- **Multi-Provider Gateway**: Supports Gemini (cloud), Ollama, and llama.cpp (local) with independently configurable research, generation, and scoring models
- **Research Grounding**: Google Search integration for authoritative source-backed generation
- **Quality Pipeline**: Judge → Refine auditing cycle for high-fidelity training data
- **Multi-Format Export**: Alpaca, ShareGPT, QA, and raw formats
- **DPO Pair Generation**: Chosen/rejected preference pairs for Direct Preference Optimization
- **Instruction Evolution**: WizardLM-style complexity escalation
- **Conversation Trees**: Multi-turn branching dialogue generation
- **Hugging Face Publishing**: Direct upload to Hugging Face Hub

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

### Configuration

Edit `.env` to add your Gemini API key (optional — the app works with local models only).

## Architecture

- **Backend**: Express + TypeScript server with Vite middleware
- **Frontend**: React 19 + Tailwind CSS + Recharts
- **Desktop**: Electron with `contextIsolation: true` and `nodeIntegration: false`
- **Providers**: ProviderFactory pattern with ModelProvider interface

## License

Apache 2.0 — TrainEngine.ai

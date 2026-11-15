// OpenRouter free-model snapshot. Source: GET https://openrouter.ai/api/v1/models (public, no key).
// Fetched 2026-11-15T10:09:52Z: 470 models in the catalog, 17 priced $0 for prompt and completion;
// the 15 chat-usable ones are below (the other two $0 entries are Google Lyria audio-generation models).
window.SNAPSHOT_META = { fetchedAt: '2026-11-15T10:09:52Z', source: 'https://openrouter.ai/api/v1/models', catalogTotal: 470, pricedZero: 17, chatUsable: 15 };
window.FREE_MODELS = [
 {
  "id": "inclusionai/ling-3.2-flash:free",
  "name": "inclusionAI: Ling 3.2 Flash (free)",
  "description": "Ling 3.2 Flash is a hybrid reasoning model from inclusionAI that accepts text and image input, with a 1M-token context window and up to 200 images per request. Thinking can...",
  "context_length": 1048576,
  "created": 1794591958,
  "modality": "text+image->text",
  "input_modalities": [
   "text",
   "image"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "particle-ai/particle-1:free",
  "name": "Particle AI: Particle-1 (free)",
  "description": "Particle-1 is a token-efficient agentic coding model from Particle AI, post-trained on DeepSeek V4.1 Flash. It is suited for software engineering work such as terminal workflows, codebase changes, and data...",
  "context_length": 1048576,
  "created": 1793207893,
  "modality": "text+image->text",
  "input_modalities": [
   "text",
   "image"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "thinkingmachines/inkling-2-small:free",
  "name": "Thinking Machines: Inkling 2 Small (free)",
  "description": "Inkling 2 Small is an open-weight multimodal mixture-of-experts reasoning model from Thinking Machines Lab, with 17B active parameters out of 594B total. It is the first model in the second...",
  "context_length": 1048576,
  "created": 1794261847,
  "modality": "text+image->text",
  "input_modalities": [
   "text",
   "image"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "baidu/ernie-5.5-flash-preview:free",
  "name": "Baidu: ERNIE-5.5-Flash-Preview (free)",
  "description": "ERNIE 5.5 Flash Preview is the latest foundation model in the ERNIE family, with comprehensive improvements in coding, agentic capabilities, knowledge work, and deep research. It has 280 billion total...",
  "context_length": 1024000,
  "created": 1794333533,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "name": "NVIDIA: Nemotron 3 Ultra (free)",
  "description": "NVIDIA Nemotron 3 Ultra is an open frontier-reasoning and orchestration model from NVIDIA, with 55B active parameters out of 550B total (MoE). Built on a hybrid Transformer-Mamba mixture-of-experts architecture, it...",
  "context_length": 1000000,
  "created": 1780551208,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "nvidia/nemotron-3.5-lightning:free",
  "name": "NVIDIA: Nemotron 3.5 Lightning (free)",
  "description": "NVIDIA Nemotron 3.5 Lightning is an open mixture-of-experts model from NVIDIA, with 3B active parameters out of 30B total. It is suited for high-throughput agentic workloads and specialized tasks that...",
  "context_length": 1000000,
  "created": 1786452751,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "nvidia/nemotron-3.5-super-vl:free",
  "name": "NVIDIA: Nemotron 3.5 Super VL (free)",
  "description": "NVIDIA Nemotron 3.5 Super VL is an open multimodal mixture-of-experts model from NVIDIA, with 12B active parameters out of 120B total. It takes text, images, documents, GUI screenshots, and video...",
  "context_length": 1000000,
  "created": 1792076662,
  "modality": "text+image+video->text",
  "input_modalities": [
   "text",
   "image",
   "video"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "dots-studio/dots-3-note-preview:free",
  "name": "Dots Studio: Dots3-Note Preview (free)",
  "description": "Dots3-Note Preview is an open-weight mixture-of-experts model from Dots Studio, with 16B active parameters out of 280B total. It is the lightest model in the Dots 3 family and is...",
  "context_length": 512000,
  "created": 1786680361,
  "modality": "text+image->text",
  "input_modalities": [
   "text",
   "image"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "google/gemma-4-26b-a4b-it:free",
  "name": "Google: Gemma 4 26B A4B  (free)",
  "description": "Gemma 4 26B A4B IT is an instruction-tuned Mixture-of-Experts (MoE) model from Google DeepMind. Despite 25.2B total parameters, only 3.8B activate per token during inference — delivering near-31B quality at...",
  "context_length": 262144,
  "created": 1775227989,
  "modality": "text+image+video->text",
  "input_modalities": [
   "image",
   "text",
   "video"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Gemma"
 },
 {
  "id": "google/gemma-4-31b-it:free",
  "name": "Google: Gemma 4 31B (free)",
  "description": "Gemma 4 31B Instruct is Google DeepMind's 30.7B dense multimodal model supporting text and image input with text output. Features a 256K token context window, configurable thinking/reasoning mode, native function...",
  "context_length": 262144,
  "created": 1775148486,
  "modality": "text+image+video->text",
  "input_modalities": [
   "image",
   "text",
   "video"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Gemma"
 },
 {
  "id": "liquid/lfm-3-1.7b:free",
  "name": "LiquidAI: LFM3-1.7B (free)",
  "description": "A compact 1.7B-parameter text model with a 256K-token context, post-trained for agents, tool calling, and structured outputs. It reasons before it answers. Prompts and outputs may be retained and used...",
  "context_length": 262144,
  "created": 1794009477,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "recursive/flint-v1.0:free",
  "name": "Recursive: Flint (free)",
  "description": "Flint is an open-weight mixture-of-experts model from Recursive, with about 2.5B active parameters out of 40B total, built by Recursive's autoresearch system Eureka Machine for coding agents. It is suited...",
  "context_length": 262144,
  "created": 1792622765,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "cohere/north-mini-code:free",
  "name": "Cohere: North Mini Code (free)",
  "description": "North Mini Code is Cohere's first agentic coding model and the debut of its North family. A sparse mixture-of-experts model with 30B total parameters and 3B active, it is optimized...",
  "context_length": 256000,
  "created": 1781723748,
  "modality": "text->text",
  "input_modalities": [
   "text"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Cohere"
 },
 {
  "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "name": "NVIDIA: Nemotron 3 Nano Omni (free)",
  "description": "NVIDIA Nemotron™ 3 Nano Omni is a 30B-A3B open multimodal model designed to function as a perception and context sub-agent in enterprise agent systems. It accepts text, image, video, and...",
  "context_length": 256000,
  "created": 1777393095,
  "modality": "text+image+audio+video->text",
  "input_modalities": [
   "text",
   "audio",
   "image",
   "video"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Other"
 },
 {
  "id": "openrouter/free",
  "name": "Free Models Router",
  "description": "The simplest way to get free inference. openrouter/free is a router that selects free models at random from the models available on OpenRouter. The router smartly filters for models that...",
  "context_length": 200000,
  "created": 1769917427,
  "modality": "text+image->text",
  "input_modalities": [
   "text",
   "image"
  ],
  "output_modalities": [
   "text"
  ],
  "tokenizer": "Router"
 }
];

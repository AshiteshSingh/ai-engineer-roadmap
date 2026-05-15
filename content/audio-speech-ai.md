# Audio & Speech AI: ASR, TTS & Voice Agents

The audio and speech AI landscape has undergone a radical transformation with the arrival of large-scale foundation models like Whisper and neural TTS systems capable of near-human voice synthesis. Building production voice agents now requires orchestrating ASR, language understanding, TTS, and real-time streaming infrastructure into coherent pipelines. This article provides an engineering-depth exploration of modern speech AI systems, from model architectures to production deployment patterns.

## TL;DR

- **Whisper v3-turbo** is the recommended production ASR starting point — near-identical accuracy to large-v3 at 3x the speed with a pruned decoder
- **Modern TTS** models (VALL-E, XTTS, Bark) treat speech as a language modeling problem over discrete audio tokens, enabling zero-shot voice cloning
- **Speech-to-speech models** (GPT-4o, Gemini Live, Moshi) collapse the ASR → LLM → TTS pipeline into a single end-to-end system with sub-300ms latency
- **Streaming at every stage** — ASR, LLM, and TTS simultaneously — is essential for sub-second voice agent response times
- **Voice cloning requires explicit consent, audio watermarking (AudioSeal), and regulatory compliance** — treat it as a high-risk capability from day one

## Automatic Speech Recognition: The Whisper Revolution

### Whisper Architecture

OpenAI's Whisper (Radford et al., 2023) is an encoder-decoder Transformer trained on 680,000 hours of multilingual, weakly-supervised audio data from the internet. Its architecture follows a straightforward sequence-to-sequence design:

**Audio Preprocessing**: Raw audio is resampled to 16kHz, converted to an 80-channel log-Mel spectrogram with a 25ms window and 10ms hop size, then normalized. The spectrogram is processed in 30-second chunks.

**Encoder**: A small CNN stem (two 1D convolution layers with GELU activation) processes the Mel spectrogram, followed by sinusoidal positional embeddings and standard Transformer encoder blocks. The encoder converts 30 seconds of audio into a sequence of 1500 embeddings (one per 20ms frame).

**Decoder**: A standard Transformer decoder with learned positional embeddings autoregressively generates output tokens. Special tokens control task behavior:

```text
[startoftranscript] [en] [transcribe] [notimestamps] Hello, world [endoftext]
```

The genius of Whisper lies not in architectural novelty but in training data scale and multitask formulation. The same model handles transcription, translation, language identification, and timestamp prediction, selected by special tokens.

```python
import whisper

model = whisper.load_model("large-v3")

# Basic transcription
result = model.transcribe("audio.mp3")
print(result["text"])

# With word-level timestamps
result = model.transcribe("audio.mp3", word_timestamps=True)
for segment in result["segments"]:
    for word in segment["words"]:
        print(f"[{word['start']:.2f} - {word['end']:.2f}] {word['word']}")

# Translation (any language -> English)
result = model.transcribe("german_audio.mp3", task="translate")
```

### Whisper Model Variants and Performance

| Model | Parameters | English WER | Multilingual WER | Speed Factor |
|-------|-----------|-------------|-------------------|--------------|
| tiny | 39M | 7.6% | 14.2% | 32x |
| base | 74M | 5.0% | 10.6% | 16x |
| small | 244M | 3.4% | 8.1% | 6x |
| medium | 769M | 2.9% | 6.5% | 2x |
| large-v3 | 1.55B | 2.5% | 5.2% | 1x |
| large-v3-turbo | 809M | 2.5% | 5.3% | 3x |

Word Error Rate (WER) on LibriSpeech test-clean. Speed factors are approximate relative to real-time on GPU.

**Whisper v3-turbo** deserves special mention: released by OpenAI in late 2024, it uses a pruned decoder (4 layers instead of 32) while retaining the full large-v3 encoder. The result is near-identical accuracy to large-v3 at roughly 3x the speed and half the parameter count. For most production workloads, v3-turbo is the recommended starting point — it offers the best accuracy-to-latency ratio in the Whisper family.

> **Tip:** For new projects, start with `large-v3-turbo` unless you have a specific reason to use the full `large-v3`. The accuracy difference (2.5% vs 2.5% WER) is negligible for most domains.

### Fine-Tuning Whisper

Fine-tuning Whisper for domain-specific audio (medical dictation, legal proceedings, accented speech) follows standard seq2seq fine-tuning with some speech-specific considerations:

```python
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments
import torch

processor = WhisperProcessor.from_pretrained("openai/whisper-large-v3")
model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-large-v3")

# Freeze encoder for efficiency (optional - helps with small datasets)
for param in model.model.encoder.parameters():
    param.requires_grad = False

training_args = Seq2SeqTrainingArguments(
    output_dir="./whisper-finetuned",
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    learning_rate=1e-5,
    warmup_steps=500,
    max_steps=5000,
    fp16=True,
    predict_with_generate=True,
    generation_max_length=225,
)

# Data collator handles padding and feature extraction
# Dataset should provide audio arrays and transcription text
trainer = Seq2SeqTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    data_collator=data_collator,
    tokenizer=processor.feature_extractor,
)
trainer.train()
```

Key fine-tuning tips:
- Use LoRA for parameter-efficient fine-tuning on small datasets (100-1000 hours)
- Data augmentation (speed perturbation, noise injection, SpecAugment) is critical for robustness
- Evaluate with both WER and domain-specific metrics (medical term accuracy, entity recognition)

### Faster Whisper and Inference Optimization

CTranslate2-based Faster Whisper achieves 4x speedup through INT8 quantization, batched beam search, and optimized attention:

```python
from faster_whisper import WhisperModel

model = WhisperModel("large-v3", device="cuda", compute_type="int8")

segments, info = model.transcribe(
    "audio.mp3",
    beam_size=5,
    vad_filter=True,       # Voice Activity Detection to skip silence
    vad_parameters=dict(
        min_silence_duration_ms=500,
        speech_pad_ms=400,
    ),
)

for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
```

WhisperX (Bain et al., 2023) adds forced alignment for precise word-level timestamps and speaker diarization, making it suitable for production transcription pipelines.

## Modern Text-to-Speech

### The TTS Architecture Landscape

Modern TTS has moved far beyond concatenative synthesis. Current approaches fall into several categories:

**Autoregressive token-based**: Models like VALL-E (Wang et al., 2023) and Bark treat speech synthesis as a language modeling problem over discrete audio tokens (from neural codecs like EnCodec). They generate audio codes token-by-token, enabling zero-shot voice cloning from a short reference.

**Non-autoregressive / Flow-based**: Models like VITS (Kim et al., 2021) and its successors use variational inference and normalizing flows for parallel synthesis, achieving much faster inference. StyleTTS 2 combines style diffusion with adversarial training for state-of-the-art naturalness.

**Diffusion-based**: Models like Grad-TTS and NaturalSpeech 2/3 apply diffusion processes to speech generation, producing highly natural audio at the cost of iterative denoising steps.

### ElevenLabs and Commercial TTS

ElevenLabs represents the state of commercial TTS, offering:

```python
from elevenlabs import ElevenLabs

client = ElevenLabs(api_key="your-key")

# Standard TTS
audio = client.text_to_speech.convert(
    voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel voice
    text="Hello, this is a test of the text to speech system.",
    model_id="eleven_multilingual_v2",
    voice_settings={
        "stability": 0.5,
        "similarity_boost": 0.75,
        "style": 0.0,
        "use_speaker_boost": True,
    },
)

# Streaming TTS for low-latency applications
audio_stream = client.text_to_speech.convert_as_stream(
    voice_id="21m00Tcm4TlvDq8ikWAM",
    text="Streaming reduces time to first audio byte.",
    model_id="eleven_turbo_v2_5",
)
```

### Open-Source TTS: Bark, XTTS, and Piper

**Bark** (Suno AI): A GPT-style model that generates audio from text prompts, capable of producing speech, music, and sound effects. It uses a three-stage architecture: text-to-semantic tokens, semantic-to-coarse acoustic tokens, coarse-to-fine acoustic tokens.

**Coqui XTTS**: Coqui, the company behind the popular TTS library, shut down in late 2023. However, the XTTS v2 model and the broader Coqui TTS library remain community-maintained on GitHub and continue to be widely used. XTTS v2 supports cross-lingual voice cloning from a 6-second reference:

```python
from TTS.api import TTS

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

# Zero-shot voice cloning
tts.tts_to_file(
    text="This is a cloned voice speaking.",
    speaker_wav="reference_audio.wav",  # 6+ seconds of reference
    language="en",
    file_path="output.wav",
)
```

Note that while the library still works and the community has kept it functional, active development has slowed. For new projects, evaluate alternatives like F5-TTS, Parler-TTS, or commercial APIs.

**Piper**: A lightweight, fast TTS engine optimized for edge deployment (Raspberry Pi, mobile). Uses VITS architecture and can run in real-time on CPU. Ideal for offline voice assistants.

### Neural Audio Codecs

Neural audio codecs like Meta's EnCodec and Google's SoundStream are foundational to modern TTS. They compress audio into discrete tokens that can be modeled with language model architectures:

```text
Audio (24kHz) -> EnCodec Encoder -> 8 codebook streams at 75Hz
                                    -> Each codebook: 1024 entries
                                    -> Total: ~6kbps at high quality

Codebook hierarchy:
  - Codebook 1: Coarse acoustic structure (pitch, phonemes)
  - Codebook 2-4: Fine acoustic details (timbre, prosody)
  - Codebook 5-8: High-frequency details (breathiness, micro-prosody)
```

This tokenization enables treating speech generation as a next-token prediction problem, unifying the training framework with text LLMs.

## Voice Agent Pipelines

### Architecture Overview

A modern voice agent combines ASR, LLM, and TTS in a pipeline optimized for low latency:

```text
User Speech -> ASR -> Text -> LLM -> Response Text -> TTS -> Audio Response
     |                                                            |
     +-- Microphone/WebRTC                          Speaker/WebRTC --+

Latency budget (target < 1 second):
  - ASR: 200-400ms (streaming) or 500-1500ms (batch)
  - LLM: 200-500ms (time to first token)
  - TTS: 100-300ms (time to first audio chunk)
  - Network/buffering: 100-200ms
```

### Streaming ASR for Real-Time Applications

Batch ASR (process complete utterance) introduces unacceptable latency for conversational agents. Streaming ASR processes audio incrementally:

```python
import asyncio
import websockets
import json

class StreamingASR:
    """WebSocket-based streaming ASR client"""

    def __init__(self, model="nova-2"):
        self.model = model
        self.buffer = []
        self.final_transcript = ""

    async def stream_audio(self, audio_source):
        async with websockets.connect(
            f"wss://api.deepgram.com/v1/listen"
            f"?model={self.model}&smart_format=true"
            f"&interim_results=true&endpointing=300",
            extra_headers={"Authorization": f"Token {API_KEY}"},
        ) as ws:
            # Send audio chunks as they arrive
            async def send_audio():
                async for chunk in audio_source:
                    await ws.send(chunk)
                await ws.send(json.dumps({"type": "CloseStream"}))

            # Receive transcription results
            async def receive_results():
                async for msg in ws:
                    result = json.loads(msg)
                    transcript = result["channel"]["alternatives"][0]["transcript"]
                    if result["is_final"]:
                        self.final_transcript += transcript + " "
                        yield {"type": "final", "text": transcript}
                    else:
                        yield {"type": "interim", "text": transcript}

            send_task = asyncio.create_task(send_audio())
            async for result in receive_results():
                yield result
            await send_task
```

Key streaming ASR providers and their characteristics:

| Provider | Strengths | Notes |
|----------|-----------|-------|
| Deepgram Nova-2 | Fast, accurate | Good endpointing (~300ms latency) |
| Google Cloud STT v2 | Strong multilingual | Chirp model |
| AssemblyAI Universal-2 | Balanced | Good accuracy/latency tradeoff |
| Whisper-streaming | Open-source | Streaming wrapper around Whisper |

### End-of-Turn Detection

One of the hardest problems in voice agents is detecting when the user has finished speaking (endpointing). Approaches include:

> **Note:** Silence-based endpointing alone produces a poor experience — users pause mid-sentence all the time. Hybrid approaches that combine VAD, silence duration, and semantic completeness are more reliable in practice.

- **Silence-based**: Trigger after N ms of silence (simple but causes false triggers during pauses)
- **VAD-based**: Voice Activity Detection models like Silero VAD detect speech boundaries
- **Semantic endpointing**: Use the partial transcript to predict if the utterance is complete
- **Hybrid**: Combine silence duration, prosodic features (falling pitch), and semantic completeness

```python
class SmartEndpointer:
    def __init__(self):
        self.vad = SileroVAD()
        self.silence_threshold_ms = 700
        self.semantic_model = load_completion_predictor()

    def should_trigger(self, audio_buffer, partial_transcript):
        silence_duration = self.vad.get_silence_duration(audio_buffer)

        # Quick trigger: long silence
        if silence_duration > 1500:
            return True

        # Medium silence + complete sentence
        if silence_duration > self.silence_threshold_ms:
            completeness = self.semantic_model.predict(partial_transcript)
            if completeness > 0.8:
                return True

        return False
```

### Speaker Diarization

Speaker diarization answers "who spoke when" - essential for multi-party conversations:

**pyannote.audio** (Bredin et al., 2023) is the leading open-source diarization toolkit:

```python
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token="hf_token",
)

# Process audio file
diarization = pipeline("meeting.wav")

# Iterate over speaker turns
for turn, _, speaker in diarization.itertracks(yield_label=True):
    print(f"[{turn.start:.1f}s - {turn.end:.1f}s] {speaker}")
    # [0.2s - 3.1s] SPEAKER_00
    # [3.5s - 7.8s] SPEAKER_01
    # [8.1s - 12.4s] SPEAKER_00
```

Modern diarization pipelines combine:
1. **Voice Activity Detection** (what regions contain speech)
2. **Speaker Embedding Extraction** (d-vectors or x-vectors per segment)
3. **Clustering** (group segments by speaker identity)
4. **Overlap Detection** (handle simultaneous speech)

## WebRTC Integration

### Building Real-Time Voice Interfaces

WebRTC provides the transport layer for browser-based voice agents. The architecture involves:

```javascript
// Client-side WebRTC setup for voice agent
class VoiceAgentClient {
    constructor(serverUrl) {
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.serverUrl = serverUrl;
    }

    async start() {
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
            }
        });

        // Add audio track to peer connection
        stream.getAudioTracks().forEach(track => {
            this.pc.addTrack(track, stream);
        });

        // Data channel for transcripts and metadata
        this.dataChannel = this.pc.createDataChannel('agent', {
            ordered: true,
        });

        this.dataChannel.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript') {
                this.onTranscript(msg.text, msg.is_final);
            } else if (msg.type === 'agent_response') {
                this.onAgentResponse(msg.text);
            }
        };

        // Create and send offer
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const response = await fetch(`${this.serverUrl}/offer`, {
            method: 'POST',
            body: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
        });
        const answer = await response.json();
        await this.pc.setRemoteDescription(answer);
    }
}
```

### OpenAI Realtime API and LiveKit

OpenAI's Realtime API provides a WebSocket-based interface for speech-to-speech interaction, where the model processes audio directly without a separate ASR step:

```python
# LiveKit-based voice agent (popular open-source framework)
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import deepgram, openai, silero

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    assistant = VoiceAssistant(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-2"),
        llm=openai.LLM(model="gpt-4o"),
        tts=openai.TTS(voice="alloy"),
        # Interrupt handling
        allow_interruptions=True,
        interrupt_speech_duration=0.5,
    )

    assistant.start(ctx.room)
    await assistant.say("Hello! How can I help you today?")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

## Audio Understanding Beyond Speech

### General Audio Understanding

Models like OpenAI's GPT-4o and Google's Gemini can understand non-speech audio - music, environmental sounds, and audio events. Audio Language Models (ALMs) are emerging that can:

- Classify environmental sounds and music genres
- Answer questions about audio content
- Generate audio descriptions and captions
- Detect specific events (glass breaking, dog barking, alarm)

**CLAP** (Contrastive Language-Audio Pretraining) by LAION applies the CLIP paradigm to audio-text pairs, creating a shared embedding space for audio retrieval and classification.

### Music Understanding and Generation

Music AI has seen parallel advances:
- **MusicLM** (Agostinelli et al., 2023): Text-to-music generation via hierarchical sequence-to-sequence modeling
- **MusicGen** (Copet et al., 2023): Single-stage Transformer for music generation from text or melody
- **Jukebox** (Dhariwal et al., 2020): Raw audio generation with VQ-VAE and Transformers

## Voice Cloning Ethics and Safety

### Technical Safeguards

Voice cloning capabilities raise serious ethical concerns. Production systems should implement:

```python
class VoiceCloningSafeguards:
    def __init__(self):
        self.consent_db = ConsentDatabase()
        self.deepfake_detector = DeepfakeDetector()

    def clone_voice(self, reference_audio, speaker_id, consent_proof):
        # 1. Verify explicit consent
        if not self.consent_db.verify_consent(speaker_id, consent_proof):
            raise ConsentError("Explicit consent required for voice cloning")

        # 2. Add audio watermark to all generated speech
        cloned_voice = self.tts_model.clone(reference_audio)
        cloned_voice.enable_watermarking(
            method="audioseal",  # Meta's AudioSeal
            payload=f"synthetic:{speaker_id}:{timestamp}",
        )

        # 3. Log all generations for audit
        self.audit_log.record(
            speaker_id=speaker_id,
            timestamp=datetime.now(),
            text_generated=None,  # Logged separately per request
        )

        return cloned_voice
```

**AudioSeal** (San Roman et al., 2024) from Meta provides proactive watermarking that embeds imperceptible identifiers in generated audio, enabling detection of synthetic speech even after compression or editing.

### Regulatory Landscape

- The EU AI Act classifies deepfake audio as "high-risk" requiring disclosure
- FCC has ruled AI-generated voice robocalls illegal under existing law
- Several US states have enacted voice likeness protection laws
- Best practice: always disclose synthetic speech and obtain consent for voice cloning

> **Note:** Regulatory requirements around synthetic voice are evolving rapidly. Build consent and watermarking infrastructure early — retrofitting these controls into a production system is significantly harder than designing them in from the start.

## Production Architecture Patterns

### Latency Optimization

The end-to-end latency of a voice agent is the sum of its pipeline stages. Key optimization strategies:

1. **Streaming everything**: Use streaming ASR, streaming LLM generation, and streaming TTS simultaneously
2. **Speculative processing**: Start TTS on partial LLM output before the full response is generated
3. **Warm connections**: Keep WebSocket/gRPC connections to ASR and TTS services alive
4. **Edge deployment**: Run VAD and endpointing on-device to reduce round trips
5. **Model selection by latency**: Use smaller models (Whisper tiny, Turbo TTS) when speed matters more than quality

```python
async def streaming_voice_pipeline(audio_stream):
    """Process speech with minimum latency using streaming at every stage"""

    # Stage 1: Streaming ASR
    transcript = ""
    async for partial in streaming_asr(audio_stream):
        if partial.is_final:
            transcript = partial.text
            break

    # Stage 2: Streaming LLM - start TTS as tokens arrive
    tts_input_queue = asyncio.Queue()

    async def llm_to_tts():
        sentence_buffer = ""
        async for token in streaming_llm(transcript):
            sentence_buffer += token
            # Flush to TTS at sentence boundaries for natural prosody
            if token in ".!?":
                await tts_input_queue.put(sentence_buffer)
                sentence_buffer = ""
        if sentence_buffer:
            await tts_input_queue.put(sentence_buffer)
        await tts_input_queue.put(None)  # Signal completion

    # Stage 3: Streaming TTS - play audio as it's generated
    async def tts_to_audio():
        while True:
            text = await tts_input_queue.get()
            if text is None:
                break
            async for audio_chunk in streaming_tts(text):
                yield audio_chunk

    # Run LLM and TTS concurrently
    asyncio.create_task(llm_to_tts())
    async for audio in tts_to_audio():
        yield audio
```

## Speech-to-Speech Models

### The Shift from Pipeline to End-to-End

Traditional voice agents chain three separate systems: ASR transcribes audio to text, an LLM generates a text response, and TTS synthesizes audio output. Each handoff loses information — prosody, tone, emphasis, non-verbal cues — and adds latency. Speech-to-speech models collapse this pipeline into a single model that reasons directly over audio representations.

**GPT-4o Audio**: OpenAI's GPT-4o natively accepts and produces audio tokens alongside text tokens. Rather than transcribing speech to text internally, the model operates on audio token representations derived from a neural codec, preserving prosodic and paralinguistic information. This enables capabilities impossible with pipeline architectures: the model can sing, laugh, whisper, and modulate emotion in its responses based on the emotional tone of the input. The Realtime API exposes this capability via WebSocket connections with sub-300ms response latency.

**Gemini Live**: Google's Gemini models support real-time bidirectional audio conversation. Gemini processes audio natively within its multimodal architecture, enabling it to understand tone, pacing, and non-verbal audio cues. Gemini Live specifically targets always-on conversational interaction, supporting extended multi-turn dialogues with persistent context.

**Moshi** (Kyutai, 2024): An open-source speech-to-speech model that processes full-duplex audio — it can listen and speak simultaneously, much like a human in natural conversation. Moshi uses a dual-stream architecture where one stream models the user's speech and another models the system's speech, with cross-attention between them. The model generates audio tokens from a Mimi neural codec (a derivative of EnCodec) at 12.5 Hz, enabling real-time streaming inference. Moshi represents a significant milestone as the first fully open-source end-to-end speech-to-speech model.

### Architecture Patterns

End-to-end speech models generally follow one of two patterns:

**Audio token LLMs**: Extend a text LLM's vocabulary with discrete audio tokens from a neural codec (EnCodec, SoundStream, Mimi). The model generates interleaved text and audio tokens autoregressively. VALL-E, SpeechGPT, and GPT-4o follow this approach. The advantage is leveraging pretrained language model capabilities; the challenge is the long sequence lengths audio tokens require (75-150 tokens per second of audio across multiple codebook levels).

**Parallel audio-text generation**: Models like Moshi and SpiRit-LM generate audio and text tokens in parallel streams rather than interleaving them. This reduces sequence length and allows the model to "think in text" while simultaneously producing natural audio output.

## Conversational Speech Models

Natural human conversation involves much more than alternating monologues. Speakers overlap, interrupt, backchannel ("mm-hmm," "right"), and use prosodic cues to signal turn-taking intentions. Conventional voice agents handle none of this well — they wait for silence, process the utterance, and respond, producing an unnatural call-center-like interaction.

> **Note:** The gap between pipeline-based voice agents and full-duplex speech models is most noticeable in user perception. Even at the same factual quality, full-duplex systems feel dramatically more human.

### Full-Duplex Conversation

Full-duplex models listen and generate simultaneously, enabling natural conversational behaviors:

- **Interruption handling**: The model detects when the user starts speaking during its response and can gracefully yield the floor, adjust its response, or continue if the interruption is a backchannel. This is fundamentally different from pipeline-based interrupt detection (which simply stops TTS playback) because the model's internal state incorporates the interruption semantically
- **Backchanneling**: Generating appropriate listener responses ("uh-huh," "I see," "right") while the user is speaking, without those responses being interpreted as an attempt to take the floor
- **Turn-taking prediction**: Using prosodic features (falling intonation, phrase-final lengthening, syntactic completion) to predict when the user is about to finish, enabling faster response initiation

Moshi's dual-stream architecture is the most complete open-source implementation of full-duplex conversation. The model maintains separate "inner monologue" text streams for both speakers, with the audio generation conditioned on these text representations.

### Latency Implications

End-to-end speech models fundamentally change the latency equation:

- **Pipeline architectures** have a theoretical minimum of ASR + LLM + TTS (typically 500–1500ms)
- **Speech-to-speech models** can begin generating audio tokens as soon as input audio is processed, reducing theoretical minimum latency to a single model forward pass (50–200ms for streaming architectures)
- **In practice**, GPT-4o's Realtime API achieves ~300ms response latency — roughly matching the responsiveness of human conversation

For a broader treatment of designing conversational interactions around these latency characteristics, see Article 52 on conversational AI.

## Speech Emotion and Prosody

### Emotion Recognition from Speech

Speech carries emotional information through prosodic features — pitch contour, speaking rate, energy, voice quality — independent of lexical content. Emotion recognition from speech (Speech Emotion Recognition, or SER) has moved from hand-crafted feature extraction (MFCCs, jitter, shimmer) to end-to-end learned representations:

- **Wav2vec 2.0 / HuBERT fine-tuning**: Self-supervised speech representations from models like wav2vec 2.0 and HuBERT, when fine-tuned on emotion-labeled datasets (IEMOCAP, RAVDESS, MSP-Podcast), achieve state-of-the-art emotion classification. These models capture both spectral and temporal patterns relevant to emotion
- **Emotion2Vec** (Ma et al., 2024): A speech emotion representation model that uses self-supervised pretraining specifically designed for emotion-related features, achieving strong results across datasets without task-specific fine-tuning
- **Multimodal emotion**: Combining speech prosody with text sentiment and facial expression (when video is available) for more robust emotion recognition. The speech modality is particularly valuable because it captures emotional cues that text alone misses — sarcasm, frustration, excitement

### Expressive Speech Synthesis

Generating emotionally appropriate speech is the synthesis counterpart to emotion recognition. Modern approaches include:

**Style tokens and emotion embeddings**: Models like GST-Tacotron learn a bank of "Global Style Tokens" from training data, where each token captures a distinct speaking style (angry, sad, cheerful). At inference time, selecting or interpolating between tokens controls the emotional quality of generated speech.

**Prompt-based emotion control**: Models like Parler-TTS and ElevenLabs' API accept natural language descriptions of desired speaking style ("speak warmly and slowly, with a gentle tone"), giving users intuitive control over emotional expression without needing to understand the underlying representation.

**Reference-based synthesis**: Extracting a style embedding from a reference audio clip and using it to condition generation — "speak this text in the same emotional tone as this audio sample." This approach powers voice cloning with emotional transfer, though it raises additional ethical considerations around consent (see the voice cloning ethics section above and Article 44 on guardrails and content filtering).

For voice agent applications, emotion recognition and expressive synthesis create a feedback loop: the agent detects user frustration from prosodic cues and responds with a calmer, more empathetic tone, improving user experience in customer service and support contexts.

> **Tip:** Prompt-based emotion control (as in Parler-TTS and ElevenLabs) is generally easier to iterate on than style-token approaches, since domain experts can describe desired tone in plain language rather than engineering embedding vectors.

## Production Voice Agent Platforms

### The Managed Voice Agent Landscape

Building a production voice agent from individual ASR, LLM, and TTS components requires significant infrastructure work: WebRTC/telephony integration, latency optimization, interruption handling, fallback logic, and monitoring. A growing ecosystem of managed platforms abstracts this complexity.

**Vapi**: A developer-focused voice agent platform that provides a unified API for building phone and web voice agents. Vapi handles the real-time audio pipeline (transport, ASR, TTS, interruption detection) and lets developers focus on conversation logic. Key features include pluggable ASR/TTS/LLM providers, function calling during conversations, call transfer, and detailed analytics. Vapi supports both inbound and outbound calling via SIP/PSTN and WebRTC.

**Bland.ai**: Targets enterprise telephony use cases — outbound sales calls, appointment scheduling, customer service. Bland provides a higher-level abstraction where developers define conversation flows (sometimes called "pathways") and the platform handles voice synthesis, call management, and CRM integration. The platform emphasizes call quality metrics and A/B testing of conversation strategies.

**Retell AI**: Positions between Vapi's developer flexibility and Bland's enterprise focus. Retell provides a voice agent SDK with strong emphasis on low latency and natural conversation flow. It offers both a hosted platform and self-hostable components, along with built-in support for knowledge bases and custom LLM integration.

### Platform Selection Criteria

| Factor | Vapi | Bland.ai | Retell AI |
|--------|------|----------|-----------|
| Primary use case | General voice agents | Enterprise telephony | Balanced |
| Developer control | High (API-first) | Medium (flow-based) | High |
| Telephony | SIP + WebRTC | PSTN-native | SIP + WebRTC |
| Custom LLM support | Yes | Limited | Yes |
| Self-hosting | No | No | Partial |
| Latency optimization | Manual tuning | Managed | Managed |

For teams with strong engineering capacity that need fine-grained control over every pipeline component, building on LiveKit (open-source WebRTC framework) with pluggable ASR/TTS remains viable. For teams that want to ship a voice agent quickly and iterate on conversation design rather than infrastructure, managed platforms provide a compelling tradeoff. See Article 52 on conversational AI for guidance on designing the conversation logic itself.

## Cross-References

- **Article 52 — Conversational AI**: Voice agents are a specialized form of conversational AI. The dialogue management patterns, turn-taking strategies, and UX design principles from Article 52 apply directly to designing effective voice agent conversations.
- **Article 41 — Edge Deployment**: On-device speech processing (Whisper v3-turbo, Piper TTS, Silero VAD) enables offline voice agents and reduces latency by eliminating network round trips. The ONNX and quantization strategies covered in Article 41 are directly applicable to speech models.
- **Article 44 — Guardrails & Content Filtering**: Voice agents require input/output safety layers adapted for the audio modality — detecting harmful content in speech inputs and preventing inappropriate voice synthesis. AudioSeal watermarking and voice cloning consent verification connect to the broader guardrails framework.

## Key Takeaways

- Start with **Whisper v3-turbo** for production ASR — use Faster Whisper with INT8 quantization for additional throughput gains
- Use **streaming at every stage** (streaming ASR + streaming LLM + streaming TTS) to hit sub-second end-to-end latency; batch processing is only acceptable for offline transcription
- For new voice agent projects, evaluate **managed platforms** (Vapi, Retell AI) before building your own WebRTC pipeline — the infrastructure cost is significant
- Implement **hybrid endpointing** combining silence duration, VAD, and semantic completeness; pure silence-based triggering produces a frustrating experience
- Build **consent verification and AudioSeal watermarking** into any voice cloning workflow before launch, not after — regulatory and reputational risk is high
- When choosing between pipeline architecture and end-to-end speech models: pipeline gives you component-level control and cheaper cost; end-to-end (GPT-4o Realtime, Moshi) gives you naturalness and lower latency at higher per-token cost

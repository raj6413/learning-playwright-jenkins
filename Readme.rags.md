# QE RAG Knowledge Assistant

This project contains a local Retrieval-Augmented Generation (RAG) command-line
assistant for asking questions about QE guidance and generated QE reports. It
searches a local index for relevant text, then sends that evidence and the
question to a local Ollama model to draft an answer.

RAG does not train a model or automatically know about every file in the
repository. It can only retrieve information that was included in the most
recent index.

## How the flow works

```text
Markdown and text sources
          |
          v
  Read and split into chunks
          |
          v
 Ollama embedding model
   nomic-embed-text
          |
          v
 Local JSON vector store
          |
          | question
          v
 Embed question and rank chunks by cosine similarity
          |
          v
 Select up to 4 chunks and send them with the question
          |
          v
 Ollama generation model: qwen3:4b
          |
          v
 Print an answer with source markers and retrieval details
```

Indexing and asking are separate commands. Index after changing the source
documents or generating new reports; asking uses the saved index and does not
rebuild it.

## What gets indexed

The index command recursively reads `.md` and `.txt` files (up to 1 MB each)
from:

- `RAG/knowledge-base/` — maintained QE reference documents.
- `ai-utils/` — generated QE reports and other Markdown/text content in that
  directory.

The current indexer does **not** read reports from
`qe-intelligence-orchestrator/test-results/` or from every other QE agent's
report directory. In particular, `npm run qe:orchestrator:rag` runs the
orchestrator and then indexes the paths above; it does not currently add the
orchestrator's unified report to the RAG corpus.

Files are split into chunks of up to 1,200 characters, with a 200-character
overlap between adjacent chunks. Where possible, a chunk ends at a paragraph
break. The indexer embeds chunks in batches of 16 and writes the complete
index to:

```text
RAG/test-results/qe-rag/vector-store.json
```

Re-indexing replaces this file with a new index. The vector store is a local
JSON file, not a separate vector database.

## Setup and connectivity

Run commands from the repository root. The project uses its `tsx` npm script
and sends HTTP requests to a local Ollama server at
`http://localhost:11434`. This URL is currently fixed in
`RAG/utils/qe-rag.ts`; it is not read from an environment variable.

1. Install the project dependencies if they are not installed:

   ```sh
   npm install
   ```

2. Install Ollama for your operating system and make sure its local service is
   running. If it is not already running as a service, start it with:

   ```sh
   ollama serve
   ```

3. Download both required models:

   ```sh
   ollama pull nomic-embed-text
   ollama pull qwen3:4b
   ```

4. Confirm the local Ollama API responds:

   ```sh
   curl http://localhost:11434/api/tags
   ```

   The response should list the required models. If Ollama is running on
   another host or port, this implementation will not connect until its
   configured URL is changed.

No hosted LLM service or API key is configured by this RAG script. Document
text, questions, and retrieved evidence are sent to the local Ollama service
specified above.

## Run it

Build or refresh the vector store:

```sh
npm run qe:rag:index
```

Ask a question against the saved index:

```sh
npm run qe:rag:ask -- "What conditions should block a release?"
```

Other useful questions:

```sh
npm run qe:rag:ask -- "Explain API contract testing and its important breaking changes."
npm run qe:rag:ask -- "What should a mature API automation framework support?"
npm run qe:rag:ask -- "What release-readiness risks are described in the indexed reports?"
```

To run the orchestrator first and then refresh the RAG index:

```sh
npm run qe:orchestrator:rag
```

Remember that this combined command does not currently make the orchestrator's
unified report an indexed source; see [What gets indexed](#what-gets-indexed).

## What happens when you ask

1. The script checks that a question was provided and reads the saved vector
   store. It stops with an error if the store is missing, empty, or was made
   with a different embedding model.
2. It sends the question to Ollama's `/api/embed` endpoint using
   `nomic-embed-text`.
3. It computes cosine similarity against the saved chunk embeddings and ranks
   all chunks.
4. It selects the four highest-ranked chunks (or fewer if the index contains
   fewer than four).
5. It sends those chunks and the question to Ollama's `/api/generate` endpoint
   using `qwen3:4b`.
6. It prints the model response, retrieved source paths, similarity scores, and
   a warning if the best similarity score is below `0.15`.

The low-similarity warning does not stop generation or filter out the retrieved
chunks. The model prompt asks for evidence-based answers and source markers
such as `[S1]`; those markers are generated by the model and are not
independently checked by the script.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Vector store not found` | Run `npm run qe:rag:index` first. |
| Embedding or generation request fails | Confirm Ollama is running and reachable at `http://localhost:11434`. |
| A model is missing | Run `ollama pull nomic-embed-text` and/or `ollama pull qwen3:4b`. |
| Retrieval is unrelated or confidence is low | Confirm the relevant information is in an indexed `.md` or `.txt` file, then re-index. The script still generates an answer when the low-confidence warning appears. |
| New report content is not found | Check that the report is under `RAG/knowledge-base/` or `ai-utils/`, is no larger than 1 MB, and re-run indexing. |

## Current implementation limits

- Only Markdown and plain-text files in the listed source directories are
  indexed. Other formats and report directories are not included.
- Indexing is an explicit step; the ask command does not detect changed
  documents or refresh the store.
- Retrieval always selects up to four chunks. The similarity warning is
  informational and does not prevent an answer.
- Model output is not guaranteed to be correct or to cite every claim
  accurately. Check the printed sources and confirm important decisions
  against the original reports and policies.
- The default corpus includes guidance documents and reports in `ai-utils/`;
  it does not automatically summarize the entire QE ecosystem or its latest
  run.

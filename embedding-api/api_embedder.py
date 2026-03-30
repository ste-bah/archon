import os
import uuid
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import tiktoken

# --- Token truncation for OpenAI ada-002 (8191 token limit) ---
_ada002_enc = None

def _get_encoder():
    global _ada002_enc
    if _ada002_enc is None:
        _ada002_enc = tiktoken.encoding_for_model("text-embedding-ada-002")
    return _ada002_enc

def truncate_to_token_limit(text: str, max_tokens: int = 8000) -> str:
    """Truncate text to fit within ada-002's 8191 token limit (with margin).
    Skip tokenization for short texts (< 24000 chars) since avg token is ~3-4 chars."""
    if len(text) < 24000:
        return text
    enc = _get_encoder()
    tokens = enc.encode(text)
    if len(tokens) > max_tokens:
        print(f"[Embedder] Truncating text from {len(tokens)} to {max_tokens} tokens ({len(text)} chars)")
        return enc.decode(tokens[:max_tokens])
    return text

# --- 1. Configuration via Environment Variables ---
# EMBEDDING_BACKEND: "local" (default) or "openai"
# VECTOR_DB: "chroma" (default) or "zilliz"
EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "local").lower()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
VECTOR_DB = os.getenv("VECTOR_DB", "chroma").lower()
ZILLIZ_URI = os.getenv("ZILLIZ_URI", "")
ZILLIZ_TOKEN = os.getenv("ZILLIZ_TOKEN", "")
COLLECTION_NAME = "god_agent_vectors_1536"

# --- 2. Define Request/Response schemas ---
class EmbedRequest(BaseModel):
    texts: List[str]
    metadata: Optional[List[dict]] = None

class SearchRequest(BaseModel):
    query: str
    n_results: int = 5

app = FastAPI(title="Vector API (1536D) - Dual Embedding + Dual VectorDB")

# --- 3. Initialize embedding backend ---
model = None
openai_client = None

if EMBEDDING_BACKEND == "openai":
    print(f"[Embedder] Using OpenAI backend (text-embedding-ada-002)")
    if not OPENAI_API_KEY:
        print("WARNING: OPENAI_API_KEY not set. OpenAI embeddings will fail.")
    else:
        try:
            from openai import OpenAI
            openai_client = OpenAI(api_key=OPENAI_API_KEY)
            print("[Embedder] OpenAI client initialized successfully.")
        except ImportError:
            print("ERROR: openai package not installed. Run: pip install openai")
        except Exception as e:
            print(f"ERROR initializing OpenAI client: {e}")
else:
    print(f"[Embedder] Using LOCAL backend (gte-Qwen2-1.5B-instruct)")
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('Alibaba-NLP/gte-Qwen2-1.5B-instruct')
        model.max_seq_length = 8192
        print("[Embedder] Local model loaded successfully.")
    except Exception as e:
        print(f"CRITICAL ERROR loading local model: {e}")
        model = None


# --- 4. Vector Database Abstraction ---
class VectorStore:
    """Abstract interface for vector storage backends."""

    def store(self, ids: List[str], texts: List[str], embeddings: List[List[float]],
              metadata: Optional[List[dict]] = None) -> None:
        raise NotImplementedError

    def search(self, query_embedding: List[float], n_results: int = 5) -> dict:
        raise NotImplementedError

    def count(self) -> int:
        raise NotImplementedError

    def is_ready(self) -> bool:
        raise NotImplementedError

    def backend_name(self) -> str:
        raise NotImplementedError


class ChromaVectorStore(VectorStore):
    """ChromaDB vector store (local)."""

    def __init__(self):
        import chromadb
        self._client = chromadb.HttpClient(host='127.0.0.1', port=8001)
        self._collection = self._client.get_or_create_collection(name=COLLECTION_NAME)
        print(f"[VectorDB] ChromaDB connected, collection: {COLLECTION_NAME}")

    def store(self, ids, texts, embeddings, metadata=None):
        add_kwargs = {"documents": texts, "embeddings": embeddings, "ids": ids}
        if metadata and all(m for m in metadata):
            add_kwargs["metadatas"] = metadata
        self._collection.add(**add_kwargs)

    def search(self, query_embedding, n_results=5):
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["metadatas", "documents", "distances"]
        )
        return results

    def count(self):
        return self._collection.count()

    def is_ready(self):
        return self._collection is not None

    def backend_name(self):
        return "chroma"


class ZillizVectorStore(VectorStore):
    """Zilliz Cloud (managed Milvus) vector store."""

    def __init__(self, uri: str, token: str):
        from pymilvus import MilvusClient
        self._client = MilvusClient(uri=uri, token=token)
        self._collection = COLLECTION_NAME
        self._ensure_collection()
        print(f"[VectorDB] Zilliz connected, collection: {self._collection}")

    def _ensure_collection(self):
        """Create collection if it doesn't exist."""
        if not self._client.has_collection(self._collection):
            from pymilvus import CollectionSchema, FieldSchema, DataType
            fields = [
                FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
                FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
                FieldSchema(name="metadata_json", dtype=DataType.VARCHAR, max_length=65535),
            ]
            schema = CollectionSchema(fields=fields, enable_dynamic_field=True)
            index_params = self._client.prepare_index_params()
            index_params.add_index(
                field_name="embedding",
                index_type="AUTOINDEX",
                metric_type="COSINE",
            )
            self._client.create_collection(
                collection_name=self._collection,
                schema=schema,
                index_params=index_params,
            )
            print(f"[VectorDB] Created Zilliz collection: {self._collection}")
        else:
            print(f"[VectorDB] Zilliz collection exists: {self._collection}")

    def store(self, ids, texts, embeddings, metadata=None):
        import json
        data = []
        for i, (doc_id, text, emb) in enumerate(zip(ids, texts, embeddings)):
            row = {
                "id": doc_id,
                "text": text,
                "embedding": emb,
                "metadata_json": json.dumps(metadata[i]) if metadata and i < len(metadata) and metadata[i] else "{}",
            }
            data.append(row)
        self._client.insert(collection_name=self._collection, data=data)

    def search(self, query_embedding, n_results=5):
        import json
        results = self._client.search(
            collection_name=self._collection,
            data=[query_embedding],
            limit=n_results,
            output_fields=["text", "metadata_json"],
        )
        # Normalize to ChromaDB-compatible format for API compatibility
        documents = []
        metadatas = []
        distances = []
        ids_list = []
        for hits in results:
            for hit in hits:
                ids_list.append(hit["id"])
                documents.append(hit["entity"].get("text", ""))
                meta_str = hit["entity"].get("metadata_json", "{}")
                metadatas.append(json.loads(meta_str) if meta_str else {})
                distances.append(hit["distance"])
        return {
            "ids": [ids_list],
            "documents": [documents],
            "metadatas": [metadatas],
            "distances": [distances],
        }

    def count(self):
        stats = self._client.get_collection_stats(self._collection)
        return stats.get("row_count", 0)

    def is_ready(self):
        return self._client is not None

    def backend_name(self):
        return "zilliz"


# --- 5. Initialize Vector Store ---
vector_store: Optional[VectorStore] = None

if VECTOR_DB == "zilliz":
    if not ZILLIZ_URI or not ZILLIZ_TOKEN:
        print("CRITICAL: ZILLIZ_URI and ZILLIZ_TOKEN required for Zilliz backend")
    else:
        try:
            vector_store = ZillizVectorStore(uri=ZILLIZ_URI, token=ZILLIZ_TOKEN)
        except Exception as e:
            print(f"CRITICAL: Could not connect to Zilliz: {e}")
else:
    try:
        vector_store = ChromaVectorStore()
    except Exception as e:
        print(f"CRITICAL: Could not connect to ChromaDB: {e}")


# --- 6. Embedding generation functions ---
def generate_embeddings_local(texts: List[str], is_query: bool = False) -> List[List[float]]:
    """Generate embeddings using local gte-Qwen2 model."""
    if not model:
        raise ValueError("Local model not loaded")
    if is_query:
        embeddings = model.encode(texts, prompt_name="query", normalize_embeddings=True)
    else:
        embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()


def generate_embeddings_openai(texts: List[str], is_query: bool = False) -> List[List[float]]:
    """Generate embeddings using OpenAI text-embedding-ada-002."""
    if not openai_client:
        raise ValueError("OpenAI client not initialized. Check OPENAI_API_KEY.")
    # Truncate texts exceeding ada-002's 8191 token limit
    texts = [truncate_to_token_limit(t) for t in texts]
    all_embeddings = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = openai_client.embeddings.create(model="text-embedding-ada-002", input=batch)
        batch_embeddings = [item.embedding for item in response.data]
        all_embeddings.extend(batch_embeddings)
    return all_embeddings


def generate_embeddings(texts: List[str], is_query: bool = False) -> List[List[float]]:
    """Route to appropriate embedding backend."""
    if EMBEDDING_BACKEND == "openai":
        return generate_embeddings_openai(texts, is_query)
    else:
        return generate_embeddings_local(texts, is_query)


def is_backend_ready() -> bool:
    """Check if the selected embedding backend is ready."""
    if EMBEDDING_BACKEND == "openai":
        return openai_client is not None
    else:
        return model is not None


# --- 7. API Endpoints ---
@app.get("/")
def read_root():
    backend_ready = is_backend_ready()
    if not backend_ready:
        return {
            "status": "error",
            "backend": EMBEDDING_BACKEND,
            "vector_db": VECTOR_DB,
            "detail": f"{EMBEDDING_BACKEND.upper()} backend failed to initialize.",
        }

    model_name = "text-embedding-ada-002" if EMBEDDING_BACKEND == "openai" else "gte-Qwen2-1.5B-instruct"
    db_ready = vector_store.is_ready() if vector_store else False

    return {
        "status": "online",
        "backend": EMBEDDING_BACKEND,
        "vector_db": VECTOR_DB,
        "vector_db_ready": db_ready,
        "model": f"{model_name} (1536D)",
    }


@app.post("/embed")
def embed_and_store(request: EmbedRequest):
    if not vector_store:
        raise HTTPException(status_code=500, detail=f"Vector DB ({VECTOR_DB}) not connected.")
    if not is_backend_ready():
        raise HTTPException(status_code=500, detail=f"{EMBEDDING_BACKEND.upper()} backend not ready.")

    try:
        embeddings = generate_embeddings(request.texts, is_query=False)
        ids = [str(uuid.uuid4()) for _ in request.texts]
        vector_store.store(ids, request.texts, embeddings, request.metadata)

        return {
            "message": f"Successfully stored {len(ids)} items",
            "ids": ids,
            "dims": len(embeddings[0]),
            "backend": EMBEDDING_BACKEND,
            "vector_db": VECTOR_DB,
            "embeddings": embeddings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
def search(request: SearchRequest):
    if not vector_store:
        raise HTTPException(status_code=500, detail=f"Vector DB ({VECTOR_DB}) not connected.")
    if not is_backend_ready():
        raise HTTPException(status_code=500, detail=f"{EMBEDDING_BACKEND.upper()} backend not ready.")

    try:
        query_vector = generate_embeddings([request.query], is_query=True)
        results = vector_store.search(query_vector[0], n_results=request.n_results)
        return {"results": results, "backend": EMBEDDING_BACKEND, "vector_db": VECTOR_DB}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/backend")
def get_backend_info():
    """Return current backend configuration."""
    return {
        "embedding_backend": EMBEDDING_BACKEND,
        "embedding_ready": is_backend_ready(),
        "vector_db": VECTOR_DB,
        "vector_db_ready": vector_store.is_ready() if vector_store else False,
        "openai_key_set": bool(OPENAI_API_KEY),
        "zilliz_configured": bool(ZILLIZ_URI and ZILLIZ_TOKEN),
        "dimensions": 1536,
        "supported_embedding_backends": ["local", "openai"],
        "supported_vector_dbs": ["chroma", "zilliz"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

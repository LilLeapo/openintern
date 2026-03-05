#!/usr/bin/env python3
"""
Batch ingest local PDF files into MemU using MinerU extraction.

Flow:
1) Apply MinerU batch upload URLs
2) Upload local PDF files
3) Poll MinerU batch extraction results
4) Download each result ZIP and extract textual content
5) Chunk text and write into MemU memory
6) Persist progress state for resume/retry
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
import os
import re
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import requests
except Exception:  # pragma: no cover - runtime guard
    requests = None  # type: ignore


TERMINAL_STATES = {"done", "failed"}
RUNNING_STATES = {"waiting-file", "pending", "running", "converting"}
DEFAULT_MINERU_BASE = "https://mineru.net"
DEFAULT_MEMU_BASE = "https://api.memu.so"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


@dataclass
class FileJob:
    path: Path
    name: str
    sha256: str
    data_id: str


@dataclass
class ExtractedImage:
    name: str
    data: bytes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch parse PDF by MinerU and ingest chunks into MemU."
    )
    parser.add_argument("--input-dir", required=True, help="Directory containing PDF files.")
    parser.add_argument("--recursive", action="store_true", help="Recursively scan input directory.")
    parser.add_argument("--max-files", type=int, default=0, help="Limit number of files, 0 means no limit.")
    parser.add_argument("--batch-size", type=int, default=20, help="MinerU upload batch size (max 200).")
    parser.add_argument("--state-file", default=".cache/mineru_memu_ingest_state.json", help="Progress state file path.")
    parser.add_argument("--force", action="store_true", help="Re-ingest files even if already ingested.")
    parser.add_argument(
        "--save-extracted",
        action="store_true",
        help="Save merged extracted text for each PDF to local files.",
    )
    parser.add_argument(
        "--save-extracted-images",
        action="store_true",
        help="Save extracted images from MinerU zip to local files.",
    )
    parser.add_argument(
        "--extracted-dir",
        default=".cache/mineru_extracted",
        help="Output directory used by --save-extracted.",
    )

    parser.add_argument("--mineru-token", default="", help="MinerU API token. Fallback env MINERU_API_TOKEN.")
    parser.add_argument("--mineru-base-url", default=DEFAULT_MINERU_BASE, help="MinerU API base URL.")
    parser.add_argument("--model-version", default="vlm", choices=["pipeline", "vlm", "MinerU-HTML"], help="MinerU model version.")
    parser.add_argument("--language", default="", help="MinerU language option, e.g. ch/en.")
    parser.add_argument("--is-ocr", action="store_true", help="Enable OCR for all files.")
    parser.add_argument("--disable-formula", action="store_true", help="Disable formula extraction.")
    parser.add_argument("--disable-table", action="store_true", help="Disable table extraction.")
    parser.add_argument("--poll-interval", type=int, default=8, help="Batch polling interval in seconds.")
    parser.add_argument("--poll-timeout", type=int, default=7200, help="Batch polling timeout in seconds.")

    parser.add_argument("--memu-base-url", default="", help="MemU base URL. Fallback config/env.")
    parser.add_argument("--memu-api-key", default="", help="MemU API key. Fallback config/env.")
    parser.add_argument("--memu-api-style", default="", choices=["cloudV3", "localSimple", "mem0V1"], help="MemU API style.")
    parser.add_argument("--memu-endpoint-memorize", default="", help="Override memorize endpoint path.")
    parser.add_argument(
        "--memu-endpoint-memorize-file",
        default="",
        help="Override memorize file endpoint path (default localSimple: /memorize/file).",
    )
    parser.add_argument("--memu-user-id", default="", help="MemU user_id.")
    parser.add_argument("--memu-agent-id", default="", help="MemU agent_id.")
    parser.add_argument(
        "--memu-scope",
        default="papers",
        choices=["chat", "papers"],
        help="OpenIntern memory scope used to build default agent_id.",
    )
    parser.add_argument(
        "--memu-channel",
        default="cli",
        help="Default channel part for MemU user_id (<channel>:<chat_id>).",
    )
    parser.add_argument(
        "--memu-chat-id",
        default="pdf-import",
        help="Default chat_id part for MemU user_id (<channel>:<chat_id>).",
    )
    parser.add_argument(
        "--memu-timeout",
        type=int,
        default=0,
        help="MemU request timeout in seconds. 0 means config/env/default.",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop immediately on first MemU write failure (default is continue).",
    )
    parser.add_argument(
        "--ingest-images",
        action="store_true",
        help="Ingest MinerU extracted images into MemU using /memorize/file.",
    )
    parser.add_argument(
        "--max-images-per-file",
        type=int,
        default=0,
        help="Limit image ingestion per PDF, 0 means no limit.",
    )
    parser.add_argument(
        "--disable-image-anchor-text",
        action="store_true",
        help="Disable companion text memory per ingested image.",
    )
    parser.add_argument("--openintern-config", default="~/.openintern/config.json", help="OpenIntern config path for MemU defaults.")

    parser.add_argument("--chunk-size", type=int, default=1600, help="Text chunk size in characters.")
    parser.add_argument("--chunk-overlap", type=int, default=200, help="Chunk overlap in characters.")
    parser.add_argument("--dry-run", action="store_true", help="Run extraction only, skip MemU writes.")

    return parser.parse_args()


def require_requests() -> None:
    if requests is None:  # pragma: no cover - runtime guard
        raise SystemExit(
            "Missing dependency: requests. Install with: python3 -m pip install requests"
        )


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def read_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_openintern_memu_defaults(
    config_path: Path,
    scope: str,
    channel: str,
    chat_id: str,
) -> Dict[str, str]:
    config = read_json(config_path)
    memu = (((config.get("memory") or {}).get("memu") or {}) if isinstance(config, dict) else {})
    agent_id = str(memu.get("agentId") or "openintern").strip()
    scopes = memu.get("scopes") if isinstance(memu.get("scopes"), dict) else {}
    scope_suffix = str(scopes.get(scope) or scope).strip()
    scoped_agent = f"{agent_id}:{scope_suffix}" if scope_suffix else agent_id
    endpoints = memu.get("endpoints") if isinstance(memu.get("endpoints"), dict) else {}
    return {
        "base_url": str(memu.get("baseUrl") or "").strip(),
        "api_key": str(memu.get("apiKey") or "").strip(),
        "api_style": str(memu.get("apiStyle") or "").strip(),
        "scoped_agent_id": scoped_agent,
        "default_user_id": f"{channel}:{chat_id}",
        "endpoint_memorize": str(endpoints.get("memorize") or "").strip(),
        "endpoint_memorize_file": str(endpoints.get("memorizeFile") or "").strip(),
        "timeout_ms": str(memu.get("timeoutMs") or "").strip(),
    }


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_data_id(path: Path, sha256_value: str) -> str:
    base = path.stem
    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", base).strip("._-")
    if not base:
        base = "pdf"
    digest = sha256_value[:12]
    candidate = f"{base}_{digest}"
    return candidate[:120]


def discover_pdf_files(input_dir: Path, recursive: bool, max_files: int) -> List[Path]:
    pattern = "**/*.pdf" if recursive else "*.pdf"
    files = sorted([p for p in input_dir.glob(pattern) if p.is_file()])
    if max_files > 0:
        files = files[:max_files]
    return files


def chunked(items: Sequence[FileJob], size: int) -> Iterable[List[FileJob]]:
    for i in range(0, len(items), size):
        yield list(items[i : i + size])


class MinerUClient:
    def __init__(self, token: str, base_url: str, timeout: int = 120) -> None:
        self.token = token.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def _request_json(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        for attempt in range(1, 5):
            try:
                resp = self.session.request(method, url, json=payload, timeout=self.timeout)
                data = resp.json() if resp.content else {}
                if resp.status_code >= 500:
                    raise RuntimeError(f"MinerU HTTP {resp.status_code}: {data}")
                if resp.status_code >= 400:
                    raise ValueError(f"MinerU HTTP {resp.status_code}: {data}")
                if int(data.get("code", -1)) != 0:
                    raise RuntimeError(f"MinerU API error: {data}")
                return data
            except ValueError:
                raise
            except Exception as exc:
                if attempt >= 4:
                    raise RuntimeError(f"MinerU request failed after retries: {url}") from exc
                time.sleep(min(2 ** (attempt - 1), 8))
        raise RuntimeError("Unreachable")

    def create_upload_batch(
        self,
        jobs: Sequence[FileJob],
        model_version: str,
        enable_formula: bool,
        enable_table: bool,
        language: str,
        is_ocr: bool,
    ) -> Tuple[str, List[str]]:
        files: List[Dict[str, Any]] = []
        for job in jobs:
            payload: Dict[str, Any] = {"name": job.name, "data_id": job.data_id}
            if is_ocr:
                payload["is_ocr"] = True
            files.append(payload)

        body: Dict[str, Any] = {
            "files": files,
            "model_version": model_version,
            "enable_formula": enable_formula,
            "enable_table": enable_table,
        }
        if language:
            body["language"] = language

        res = self._request_json("POST", "/api/v4/file-urls/batch", body)
        data = res.get("data", {})
        batch_id = str(data.get("batch_id") or "").strip()
        urls = data.get("file_urls") or data.get("files") or []
        if not batch_id or not isinstance(urls, list) or len(urls) != len(jobs):
            raise RuntimeError(f"Invalid MinerU batch upload response: {res}")
        return batch_id, [str(u) for u in urls]

    def upload_file(self, upload_url: str, file_path: Path) -> None:
        with file_path.open("rb") as f:
            resp = requests.put(upload_url, data=f, timeout=max(self.timeout, 300))
        if resp.status_code != 200:
            raise RuntimeError(f"Upload failed ({resp.status_code}) for {file_path.name}")

    def get_batch_results(self, batch_id: str) -> List[Dict[str, Any]]:
        res = self._request_json("GET", f"/api/v4/extract-results/batch/{batch_id}")
        data = res.get("data", {})
        results = data.get("extract_result") or []
        if not isinstance(results, list):
            return []
        normalized = []
        for row in results:
            if isinstance(row, dict):
                normalized.append(row)
        return normalized

    def wait_batch(
        self,
        batch_id: str,
        expected_data_ids: Sequence[str],
        poll_interval: int,
        timeout_s: int,
    ) -> Dict[str, Dict[str, Any]]:
        expected = set(expected_data_ids)
        deadline = time.time() + timeout_s
        last_print = 0.0

        while True:
            rows = self.get_batch_results(batch_id)
            by_data_id: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                data_id = str(row.get("data_id") or "").strip()
                if data_id:
                    by_data_id[data_id] = row

            terminal = 0
            running = 0
            for data_id in expected:
                row = by_data_id.get(data_id)
                state = str((row or {}).get("state") or "")
                if state in TERMINAL_STATES:
                    terminal += 1
                elif state in RUNNING_STATES:
                    running += 1

            now = time.time()
            if now - last_print > 5:
                log(
                    f"[MinerU] batch={batch_id} terminal={terminal}/{len(expected)} running={running}"
                )
                last_print = now

            if terminal == len(expected):
                return by_data_id

            if time.time() > deadline:
                raise TimeoutError(
                    f"Batch {batch_id} timed out after {timeout_s}s (terminal {terminal}/{len(expected)})."
                )

            time.sleep(max(1, poll_interval))


class MemUIngestClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        api_style: str,
        endpoint_memorize: str,
        endpoint_memorize_file: str,
        user_id: str,
        agent_id: str,
        timeout: int = 60,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        self.api_style = api_style
        self.user_id = user_id
        self.agent_id = agent_id
        self.timeout = timeout

        if endpoint_memorize:
            self.endpoint_memorize = endpoint_memorize if endpoint_memorize.startswith("/") else f"/{endpoint_memorize}"
        else:
            if api_style == "localSimple":
                self.endpoint_memorize = "/memorize"
            elif api_style == "mem0V1":
                self.endpoint_memorize = "/api/v1/memories"
            else:
                self.endpoint_memorize = "/api/v3/memory/memorize"

        if endpoint_memorize_file:
            self.endpoint_memorize_file = (
                endpoint_memorize_file
                if endpoint_memorize_file.startswith("/")
                else f"/{endpoint_memorize_file}"
            )
        else:
            self.endpoint_memorize_file = "/memorize/file" if api_style == "localSimple" else ""

        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        if self.api_key:
            self.session.headers["Authorization"] = f"Bearer {self.api_key}"

    def memorize(self, content: str) -> Dict[str, Any]:
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        headers: Dict[str, str] = {"Content-Type": "application/json"}

        if self.api_style == "localSimple":
            payload: Dict[str, Any] = {
                "content": content,
                "user_id": self.user_id,
                "agent_id": self.agent_id,
            }
        elif self.api_style == "mem0V1":
            payload = {
                "messages": [{"role": "user", "content": content}],
                "run_id": self.user_id,
                "metadata": {"agent_id": self.agent_id},
            }
            headers["X-User-Id"] = self.user_id
        else:
            payload = {
                "conversation": [{"role": "user", "content": content, "timestamp": now_iso}],
                "user_id": self.user_id,
                "agent_id": self.agent_id,
            }

        url = f"{self.base_url}{self.endpoint_memorize}"
        last_error: Optional[str] = None
        for attempt in range(1, 5):
            try:
                resp = self.session.post(url, json=payload, headers=headers, timeout=self.timeout)
                if resp.status_code >= 500:
                    raise RuntimeError(f"MemU HTTP {resp.status_code}: {resp.text[:400]}")
                if resp.status_code >= 400:
                    raise ValueError(f"MemU HTTP {resp.status_code}: {resp.text[:400]}")
                text = resp.text if resp.content else ""
                if not text.strip():
                    return {}
                try:
                    data = resp.json()
                except Exception:
                    # Keep compatibility with local deployments that return plain text.
                    return {"text": text[:1000]}
                return data if isinstance(data, dict) else {}
            except ValueError:
                raise
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt >= 4:
                    suffix = f"; last_error={last_error}" if last_error else ""
                    raise RuntimeError(f"MemU memorize failed after retries: {url}{suffix}") from exc
                time.sleep(min(2 ** (attempt - 1), 8))
        raise RuntimeError("Unreachable")

    def memorize_file(self, file_name: str, file_bytes: bytes) -> Dict[str, Any]:
        if not self.endpoint_memorize_file:
            raise RuntimeError("MemU file memorize endpoint is not configured.")

        mime_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        data = {
            "user_id": self.user_id,
            "agent_id": self.agent_id,
        }
        files = {
            "file": (file_name, file_bytes, mime_type),
        }
        url = f"{self.base_url}{self.endpoint_memorize_file}"
        last_error: Optional[str] = None
        for attempt in range(1, 5):
            try:
                resp = self.session.post(
                    url,
                    data=data,
                    files=files,
                    timeout=self.timeout,
                )
                if resp.status_code >= 500:
                    raise RuntimeError(f"MemU HTTP {resp.status_code}: {resp.text[:400]}")
                if resp.status_code >= 400:
                    raise ValueError(f"MemU HTTP {resp.status_code}: {resp.text[:400]}")
                if not resp.content:
                    return {}
                try:
                    data_json = resp.json()
                except Exception:
                    return {"text": resp.text[:1000]}
                return data_json if isinstance(data_json, dict) else {}
            except ValueError:
                raise
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt >= 4:
                    suffix = f"; last_error={last_error}" if last_error else ""
                    raise RuntimeError(f"MemU file memorize failed after retries: {url}{suffix}") from exc
                time.sleep(min(2 ** (attempt - 1), 8))
        raise RuntimeError("Unreachable")


def decode_bytes(data: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return data.decode(enc)
        except Exception:
            continue
    return data.decode("utf-8", errors="ignore")


def extract_json_strings(obj: Any, parent_key: str = "") -> List[str]:
    out: List[str] = []
    preferred_keys = (
        "text",
        "content",
        "markdown",
        "md",
        "html",
        "latex",
        "title",
        "abstract",
        "paragraph",
        "caption",
        "body",
    )

    if isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(extract_json_strings(v, str(k).lower()))
    elif isinstance(obj, list):
        for item in obj:
            out.extend(extract_json_strings(item, parent_key))
    elif isinstance(obj, str):
        s = obj.strip()
        if len(s) < 12:
            return out
        if any(key in parent_key for key in preferred_keys) or len(s) >= 180:
            out.append(s)
    return out


def extract_zip_artifacts(zip_bytes: bytes) -> Tuple[str, List[ExtractedImage]]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [name for name in zf.namelist() if not name.endswith("/")]
        if not names:
            raise RuntimeError("Empty MinerU result zip.")

        def priority(name: str) -> Tuple[int, str]:
            suffix = Path(name).suffix.lower()
            order = {
                ".md": 0,
                ".markdown": 1,
                ".txt": 2,
                ".html": 3,
                ".json": 4,
                ".tex": 5,
                ".latex": 6,
            }
            return (order.get(suffix, 99), name)

        chunks: List[str] = []
        images: List[ExtractedImage] = []
        seen = set()
        for name in sorted(names, key=priority):
            suffix = Path(name).suffix.lower()
            raw = zf.read(name)
            if suffix in IMAGE_SUFFIXES:
                images.append(ExtractedImage(name=name, data=raw))
                continue
            if suffix in {".md", ".markdown", ".txt", ".html", ".tex", ".latex"}:
                text = decode_bytes(raw).strip()
                if text:
                    block = f"# File: {name}\n\n{text}"
                    if block not in seen:
                        chunks.append(block)
                        seen.add(block)
                continue

            if suffix == ".json":
                try:
                    payload = json.loads(decode_bytes(raw))
                except Exception:
                    continue
                strs = extract_json_strings(payload)
                if strs:
                    text = "\n\n".join(strs)
                    block = f"# File: {name}\n\n{text}"
                    if block not in seen:
                        chunks.append(block)
                        seen.add(block)

        if not chunks:
            raise RuntimeError("No textual content found in MinerU result zip.")

        merged = "\n\n".join(chunks)
        merged = merged.replace("\r\n", "\n").replace("\r", "\n")
        merged = re.sub(r"\n{3,}", "\n\n", merged)
        return merged.strip(), images


def split_text_chunks(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if chunk_overlap < 0:
        raise ValueError("chunk_overlap must be >= 0")
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    src = text.strip()
    if not src:
        return []
    if len(src) <= chunk_size:
        return [src]

    chunks: List[str] = []
    start = 0
    min_cut = int(chunk_size * 0.6)
    while start < len(src):
        target = min(start + chunk_size, len(src))
        end = target
        if target < len(src):
            low = min(start + min_cut, len(src))
            segment = src[low:target]
            candidates = [
                segment.rfind("\n\n"),
                segment.rfind("\n"),
                segment.rfind("。"),
                segment.rfind(". "),
                segment.rfind(" "),
            ]
            best = max(candidates)
            if best > 0:
                end = low + best + 1
        if end <= start:
            end = min(start + chunk_size, len(src))
        part = src[start:end].strip()
        if part:
            chunks.append(part)
        if end >= len(src):
            break
        start = max(end - chunk_overlap, start + 1)
    return chunks


def build_memu_content(file_name: str, data_id: str, chunk_idx: int, chunk_total: int, chunk_text: str) -> str:
    return (
        f"[source_file={file_name}] [data_id={data_id}] [chunk={chunk_idx}/{chunk_total}]\n\n"
        f"{chunk_text}"
    )


def resolve_extracted_output_path(
    job: FileJob,
    input_root: Path,
    extracted_root: Path,
) -> Path:
    try:
        relative = job.path.resolve().relative_to(input_root.resolve())
    except Exception:
        relative = Path(job.name)
    return (extracted_root / relative).with_suffix(".md")


def save_extracted_text(
    job: FileJob,
    input_root: Path,
    extracted_root: Path,
    text: str,
) -> Path:
    output_path = resolve_extracted_output_path(job, input_root, extracted_root)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        f"<!-- source_file={job.name}; data_id={job.data_id}; sha256={job.sha256}; "
        f"generated_at={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} -->\n\n"
    )
    output_path.write_text(header + text.strip() + "\n", encoding="utf-8")
    return output_path


def resolve_extracted_assets_root(
    job: FileJob,
    input_root: Path,
    extracted_root: Path,
) -> Path:
    text_path = resolve_extracted_output_path(job, input_root, extracted_root)
    return text_path.with_suffix("").parent / f"{text_path.stem}_assets"


def save_extracted_images(
    job: FileJob,
    input_root: Path,
    extracted_root: Path,
    images: Sequence[ExtractedImage],
) -> List[str]:
    assets_root = resolve_extracted_assets_root(job, input_root, extracted_root)
    saved: List[str] = []
    for image in images:
        target = assets_root / image.name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(image.data)
        saved.append(str(target))
    return saved


def extract_image_anchor_snippet(merged_text: str, image_name: str, max_len: int = 320) -> str:
    idx = merged_text.find(image_name)
    if idx < 0:
        return ""
    start = max(0, idx - 260)
    end = min(len(merged_text), idx + 260)
    snippet = merged_text[start:end]
    snippet = re.sub(r"\s+", " ", snippet).strip()
    if len(snippet) > max_len:
        snippet = snippet[:max_len].rstrip() + "..."
    return snippet


def build_image_anchor_text(
    file_name: str,
    data_id: str,
    image_name: str,
    merged_text: str,
) -> str:
    snippet = extract_image_anchor_snippet(merged_text, image_name)
    base = (
        f"[source_file={file_name}] [data_id={data_id}] [image={image_name}] "
        "Image extracted from MinerU output and stored as multimodal memory."
    )
    if snippet:
        return f"{base}\n\nContext snippet: {snippet}"
    return base


def download_bytes(url: str, timeout: int = 300) -> bytes:
    resp = requests.get(url, timeout=timeout)
    if resp.status_code >= 400:
        raise RuntimeError(f"Download failed {resp.status_code}: {url}")
    return resp.content


def parse_int(value: str, fallback: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return fallback


def resolve_memu_options(args: argparse.Namespace) -> Dict[str, Any]:
    scope = args.memu_scope.strip() or "papers"
    channel = args.memu_channel.strip() or "cli"
    chat_id = args.memu_chat_id.strip() or "pdf-import"
    config_defaults = load_openintern_memu_defaults(
        normalize_path(args.openintern_config),
        scope=scope,
        channel=channel,
        chat_id=chat_id,
    )

    memu_base = (
        args.memu_base_url.strip()
        or config_defaults.get("base_url", "")
        or str(os.getenv("MEMU_BASE_URL", "")).strip()
        or DEFAULT_MEMU_BASE
    )
    memu_key = (
        args.memu_api_key.strip()
        or config_defaults.get("api_key", "")
        or str(os.getenv("MEMU_API_KEY", "")).strip()
    )
    memu_style = (
        args.memu_api_style.strip()
        or config_defaults.get("api_style", "")
        or str(os.getenv("MEMU_API_STYLE", "")).strip()
        or "cloudV3"
    )
    memu_user = (
        args.memu_user_id.strip()
        or str(os.getenv("MEMU_USER_ID", "")).strip()
        or config_defaults.get("default_user_id", "")
    )
    memu_agent = (
        args.memu_agent_id.strip()
        or str(os.getenv("MEMU_AGENT_ID", "")).strip()
        or config_defaults.get("scoped_agent_id", "")
    )
    endpoint_memorize = (
        args.memu_endpoint_memorize.strip()
        or str(os.getenv("MEMU_ENDPOINT_MEMORIZE", "")).strip()
        or config_defaults.get("endpoint_memorize", "")
    )
    endpoint_memorize_file = (
        args.memu_endpoint_memorize_file.strip()
        or str(os.getenv("MEMU_ENDPOINT_MEMORIZE_FILE", "")).strip()
        or config_defaults.get("endpoint_memorize_file", "")
    )
    timeout_s = (
        args.memu_timeout
        if args.memu_timeout > 0
        else parse_int(str(os.getenv("MEMU_TIMEOUT_SECONDS", "")).strip(), 0)
    )
    if timeout_s <= 0:
        timeout_ms = parse_int(config_defaults.get("timeout_ms", ""), 0)
        timeout_s = max(1, int(timeout_ms / 1000)) if timeout_ms > 0 else 60
    # Batch ingestion is throughput-oriented; keep timeout generous to avoid false timeout retries.
    timeout_s = max(timeout_s, 60)

    if not memu_user:
        raise ValueError("Missing memu user_id. Use --memu-user-id or set MEMU_USER_ID.")
    if not memu_agent:
        raise ValueError("Missing memu agent_id. Use --memu-agent-id or set MEMU_AGENT_ID.")
    if memu_style == "cloudV3" and not memu_key:
        raise ValueError("Missing memu api_key for cloudV3. Use --memu-api-key or set MEMU_API_KEY.")

    return {
        "base_url": memu_base,
        "api_key": memu_key,
        "api_style": memu_style,
        "user_id": memu_user,
        "agent_id": memu_agent,
        "endpoint_memorize": endpoint_memorize,
        "endpoint_memorize_file": endpoint_memorize_file,
        "timeout_s": timeout_s,
        "scope": scope,
    }


def update_state_entry(state: Dict[str, Any], file_path: Path, patch: Dict[str, Any]) -> None:
    files = state.setdefault("files", {})
    key = str(file_path.resolve())
    current = files.get(key) if isinstance(files, dict) else None
    if not isinstance(current, dict):
        current = {}
    current.update(patch)
    files[key] = current


def main() -> int:
    args = parse_args()
    require_requests()

    mineru_token = args.mineru_token.strip() or os.getenv("MINERU_API_TOKEN", "").strip()
    if not mineru_token:
        raise SystemExit("Missing MinerU token. Use --mineru-token or env MINERU_API_TOKEN.")

    input_dir = normalize_path(args.input_dir)
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    if args.batch_size <= 0 or args.batch_size > 200:
        raise SystemExit("--batch-size must be within 1..200")

    memu_opts: Dict[str, Any] = {}
    memu_client: Optional[MemUIngestClient] = None
    if not args.dry_run:
        memu_opts = resolve_memu_options(args)
        memu_client = MemUIngestClient(
            base_url=memu_opts["base_url"],
            api_key=memu_opts["api_key"],
            api_style=memu_opts["api_style"],
            endpoint_memorize=str(memu_opts.get("endpoint_memorize") or "").strip(),
            endpoint_memorize_file=str(memu_opts.get("endpoint_memorize_file") or "").strip(),
            user_id=memu_opts["user_id"],
            agent_id=memu_opts["agent_id"],
            timeout=int(memu_opts.get("timeout_s", 60)),
        )
        if args.ingest_images and not memu_client.endpoint_memorize_file:
            raise SystemExit(
                "Image ingestion is enabled but MemU file endpoint is not configured. "
                "Use --memu-endpoint-memorize-file or configure localSimple /memorize/file."
            )

    mineru_client = MinerUClient(
        token=mineru_token,
        base_url=args.mineru_base_url,
    )

    state_file = normalize_path(args.state_file)
    extracted_dir = (
        normalize_path(args.extracted_dir)
        if (args.save_extracted or args.save_extracted_images)
        else None
    )
    state: Dict[str, Any] = read_json(state_file)
    if not state:
        state = {"version": 1, "files": {}}

    files = discover_pdf_files(input_dir, args.recursive, args.max_files)
    if not files:
        log(f"No PDF files found in {input_dir}")
        return 0

    jobs: List[FileJob] = []
    for path in files:
        sha = file_sha256(path)
        key = str(path.resolve())
        previous = (state.get("files", {}) or {}).get(key, {})
        if (
            not args.force
            and isinstance(previous, dict)
            and previous.get("status") == "ingested"
            and previous.get("sha256") == sha
        ):
            log(f"[SKIP] {path.name} already ingested.")
            continue
        data_id = (
            str(previous.get("data_id") or "").strip()
            if isinstance(previous, dict) and previous.get("sha256") == sha
            else safe_data_id(path, sha)
        )
        jobs.append(FileJob(path=path, name=path.name, sha256=sha, data_id=data_id))

    if not jobs:
        log("Nothing to ingest.")
        return 0

    log(
        f"Prepared {len(jobs)} files for ingestion. "
        f"MinerU model={args.model_version}, "
        f"MemU style={memu_opts.get('api_style', 'disabled(dry-run)')}."
    )
    if not args.dry_run:
        log(
            f"MemU target={memu_opts.get('base_url')} "
            f"user_id={memu_opts.get('user_id')} "
            f"agent_id={memu_opts.get('agent_id')} "
            f"scope={memu_opts.get('scope')} "
            f"endpoint_memorize={memu_opts.get('endpoint_memorize') or '/memorize'} "
            f"endpoint_memorize_file={memu_opts.get('endpoint_memorize_file') or '/memorize/file'}"
        )
    if extracted_dir is not None and args.save_extracted:
        log(f"Extracted text output dir: {extracted_dir}")
    if extracted_dir is not None and args.save_extracted_images:
        log(f"Extracted image output dir: {extracted_dir}")

    try:
        for batch_jobs in chunked(jobs, args.batch_size):
            log("")
            log(f"[BATCH] submitting {len(batch_jobs)} files to MinerU...")
            batch_id, upload_urls = mineru_client.create_upload_batch(
                jobs=batch_jobs,
                model_version=args.model_version,
                enable_formula=not args.disable_formula,
                enable_table=not args.disable_table,
                language=args.language.strip(),
                is_ocr=args.is_ocr,
            )
            log(f"[BATCH] batch_id={batch_id}")

            for job, upload_url in zip(batch_jobs, upload_urls):
                log(f"[UPLOAD] {job.name}")
                mineru_client.upload_file(upload_url, job.path)
                update_state_entry(
                    state,
                    job.path,
                    {
                        "sha256": job.sha256,
                        "status": "uploaded",
                        "batch_id": batch_id,
                        "data_id": job.data_id,
                        "file_name": job.name,
                        "updated_at": int(time.time()),
                    },
                )
            write_json(state_file, state)

            results_by_data_id = mineru_client.wait_batch(
                batch_id=batch_id,
                expected_data_ids=[job.data_id for job in batch_jobs],
                poll_interval=args.poll_interval,
                timeout_s=args.poll_timeout,
            )

            for job in batch_jobs:
                row = results_by_data_id.get(job.data_id)
                if not row:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": "No result row found by data_id in batch response.",
                            "updated_at": int(time.time()),
                        },
                    )
                    continue

                state_name = str(row.get("state") or "")
                if state_name == "failed":
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": str(row.get("err_msg") or "MinerU task failed."),
                            "updated_at": int(time.time()),
                        },
                    )
                    log(f"[FAILED] {job.name}: {row.get('err_msg')}")
                    continue

                if state_name != "done":
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": f"Unexpected terminal state: {state_name}",
                            "updated_at": int(time.time()),
                        },
                    )
                    log(f"[FAILED] {job.name}: unexpected state={state_name}")
                    continue

                zip_url = str(row.get("full_zip_url") or "").strip()
                if not zip_url:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": "MinerU done state without full_zip_url.",
                            "updated_at": int(time.time()),
                        },
                    )
                    log(f"[FAILED] {job.name}: full_zip_url missing")
                    continue

                log(f"[DONE] {job.name} -> download zip")
                zip_bytes = download_bytes(zip_url)
                extracted_text, extracted_images = extract_zip_artifacts(zip_bytes)
                extracted_path = ""
                if extracted_dir is not None:
                    if args.save_extracted:
                        extracted_output = save_extracted_text(
                            job=job,
                            input_root=input_dir,
                            extracted_root=extracted_dir,
                            text=extracted_text,
                        )
                        extracted_path = str(extracted_output)
                        log(f"[SAVE] {job.name} -> {extracted_output}")
                    if args.save_extracted_images and extracted_images:
                        saved_images = save_extracted_images(
                            job=job,
                            input_root=input_dir,
                            extracted_root=extracted_dir,
                            images=extracted_images,
                        )
                        log(f"[SAVE-IMAGES] {job.name}: {len(saved_images)}")
                chunks = split_text_chunks(extracted_text, args.chunk_size, args.chunk_overlap)
                image_total = len(extracted_images)
                if args.max_images_per_file > 0:
                    image_total = min(image_total, args.max_images_per_file)
                if not chunks:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": "No extracted chunks generated from MinerU result.",
                            "images_total": image_total,
                            "updated_at": int(time.time()),
                        },
                    )
                    log(f"[FAILED] {job.name}: no chunks")
                    continue

                if args.dry_run:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "done",
                            "chunks_total": len(chunks),
                            "chunk_size": args.chunk_size,
                            "chunk_overlap": args.chunk_overlap,
                            "zip_url": zip_url,
                            "extracted_path": extracted_path,
                            "images_total": image_total,
                            "images_ingested": 0,
                            "updated_at": int(time.time()),
                        },
                    )
                    log(f"[DRY-RUN] {job.name}: chunks={len(chunks)} images={image_total}")
                    continue

                ingested = 0
                previous_row = (state.get("files", {}) or {}).get(str(job.path.resolve()), {})
                resume_ingested = 0
                if not args.force and isinstance(previous_row, dict):
                    previous_sha = str(previous_row.get("sha256") or "")
                    previous_status = str(previous_row.get("status") or "")
                    previous_total = int(previous_row.get("chunks_total") or 0)
                    previous_ingested = int(previous_row.get("chunks_ingested") or 0)
                    if (
                        previous_sha == job.sha256
                        and previous_status == "failed"
                        and previous_total == len(chunks)
                        and previous_ingested > 0
                    ):
                        resume_ingested = min(previous_ingested, len(chunks))
                        ingested = previous_ingested
                        if resume_ingested >= len(chunks):
                            log(f"[RESUME] {job.name}: text chunks already ingested, skip text writes")
                        else:
                            log(
                                f"[RESUME] {job.name}: continue from chunk {resume_ingested + 1}/{len(chunks)}"
                            )

                memu_error: Optional[str] = None
                for idx, chunk in enumerate(chunks, start=1):
                    if idx <= resume_ingested:
                        continue
                    if memu_client is None:
                        raise RuntimeError("MemU client is not initialized.")
                    payload = build_memu_content(
                        file_name=job.name,
                        data_id=job.data_id,
                        chunk_idx=idx,
                        chunk_total=len(chunks),
                        chunk_text=chunk,
                    )
                    try:
                        memu_client.memorize(payload)
                    except Exception as exc:
                        memu_error = f"chunk {idx}/{len(chunks)} failed: {exc}"
                        log(f"[MEMU-FAILED] {job.name}: {memu_error}")
                        if args.fail_fast:
                            raise
                        break
                    ingested += 1
                    if idx % 10 == 0 or idx == len(chunks):
                        log(f"[MEMU] {job.name}: {idx}/{len(chunks)}")

                if memu_error:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": memu_error,
                            "chunks_total": len(chunks),
                            "chunks_ingested": ingested,
                            "chunk_size": args.chunk_size,
                            "chunk_overlap": args.chunk_overlap,
                            "zip_url": zip_url,
                            "extracted_path": extracted_path,
                            "images_total": image_total,
                            "images_ingested": 0,
                            "updated_at": int(time.time()),
                        },
                    )
                    continue

                images_ingested = 0
                image_error: Optional[str] = None
                if args.ingest_images and image_total > 0:
                    previous_row = (state.get("files", {}) or {}).get(str(job.path.resolve()), {})
                    resume_images = 0
                    if (
                        not args.force
                        and isinstance(previous_row, dict)
                        and str(previous_row.get("sha256") or "") == job.sha256
                        and str(previous_row.get("status") or "") == "failed"
                        and int(previous_row.get("chunks_ingested") or 0) >= len(chunks)
                        and int(previous_row.get("images_total") or 0) == image_total
                    ):
                        prev_img_ingested = int(previous_row.get("images_ingested") or 0)
                        if prev_img_ingested > 0:
                            resume_images = min(prev_img_ingested, image_total)
                            images_ingested = resume_images
                            if resume_images >= image_total:
                                log(
                                    f"[RESUME] {job.name}: images already ingested, skip image writes"
                                )
                            else:
                                log(
                                    f"[RESUME] {job.name}: continue from image {resume_images + 1}/{image_total}"
                                )

                    for image_idx, image in enumerate(extracted_images[:image_total], start=1):
                        if image_idx <= resume_images:
                            continue
                        if memu_client is None:
                            raise RuntimeError("MemU client is not initialized.")
                        try:
                            memu_client.memorize_file(file_name=Path(image.name).name, file_bytes=image.data)
                            images_ingested += 1
                            if not args.disable_image_anchor_text:
                                anchor_text = build_image_anchor_text(
                                    file_name=job.name,
                                    data_id=job.data_id,
                                    image_name=image.name,
                                    merged_text=extracted_text,
                                )
                                memu_client.memorize(anchor_text)
                        except Exception as exc:
                            image_error = (
                                f"image {image_idx}/{image_total} ({image.name}) failed: {exc}"
                            )
                            log(f"[MEMU-IMAGE-FAILED] {job.name}: {image_error}")
                            if args.fail_fast:
                                raise
                            break

                if image_error:
                    update_state_entry(
                        state,
                        job.path,
                        {
                            "status": "failed",
                            "error": image_error,
                            "chunks_total": len(chunks),
                            "chunks_ingested": ingested,
                            "chunk_size": args.chunk_size,
                            "chunk_overlap": args.chunk_overlap,
                            "images_total": image_total,
                            "images_ingested": images_ingested,
                            "zip_url": zip_url,
                            "extracted_path": extracted_path,
                            "updated_at": int(time.time()),
                        },
                    )
                    continue

                update_state_entry(
                    state,
                    job.path,
                    {
                        "status": "ingested",
                        "chunks_total": len(chunks),
                        "chunks_ingested": ingested,
                        "chunk_size": args.chunk_size,
                        "chunk_overlap": args.chunk_overlap,
                        "images_total": image_total,
                        "images_ingested": images_ingested,
                        "zip_url": zip_url,
                        "extracted_path": extracted_path,
                        "updated_at": int(time.time()),
                    },
                )
                log(f"[INGESTED] {job.name}: chunks={ingested} images={images_ingested}/{image_total}")

            write_json(state_file, state)

    except KeyboardInterrupt:
        write_json(state_file, state)
        log("\nInterrupted. State saved.")
        return 130
    except Exception as exc:
        write_json(state_file, state)
        log(f"\nERROR: {exc}")
        return 1

    write_json(state_file, state)
    total = len(jobs)
    ingested = 0
    failed = 0
    for job in jobs:
        row = (state.get("files", {}) or {}).get(str(job.path.resolve()), {})
        status = str((row or {}).get("status") or "")
        if status == "ingested":
            ingested += 1
        elif status == "failed":
            failed += 1

    log("")
    log(f"Finished. total={total}, ingested={ingested}, failed={failed}, state={state_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

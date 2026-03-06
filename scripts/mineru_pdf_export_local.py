#!/usr/bin/env python3
"""
Batch export local PDFs through MinerU and extract result archives locally.

Flow:
1) Apply MinerU batch upload URLs
2) Upload local PDF files
3) Poll MinerU batch extraction results
4) Download each result ZIP
5) Extract ZIP contents into local output directory
6) Persist progress state for resume/retry
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import shutil
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


@dataclass
class FileJob:
    path: Path
    name: str
    sha256: str
    data_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch parse PDF by MinerU and export extracted ZIP files locally."
    )
    parser.add_argument("--input-dir", required=True, help="Directory containing PDF files.")
    parser.add_argument("--recursive", action="store_true", help="Recursively scan input directory.")
    parser.add_argument("--max-files", type=int, default=0, help="Limit number of files, 0 means no limit.")
    parser.add_argument("--batch-size", type=int, default=20, help="MinerU upload batch size (max 200).")
    parser.add_argument(
        "--state-file",
        default=".cache/mineru_local_export_state.json",
        help="Progress state file path.",
    )
    parser.add_argument("--force", action="store_true", help="Re-export files even if already exported.")
    parser.add_argument(
        "--output-dir",
        default=".cache/mineru_exported",
        help="Directory to store extracted MinerU results.",
    )
    parser.add_argument(
        "--keep-zip",
        action="store_true",
        help="Keep downloaded ZIP file alongside extracted directory.",
    )

    parser.add_argument("--mineru-token", default="", help="MinerU API token. Fallback env MINERU_API_TOKEN.")
    parser.add_argument("--mineru-base-url", default=DEFAULT_MINERU_BASE, help="MinerU API base URL.")
    parser.add_argument(
        "--model-version",
        default="vlm",
        choices=["pipeline", "vlm", "MinerU-HTML"],
        help="MinerU model version.",
    )
    parser.add_argument("--language", default="", help="MinerU language option, e.g. ch/en.")
    parser.add_argument("--is-ocr", action="store_true", help="Enable OCR for all files.")
    parser.add_argument("--disable-formula", action="store_true", help="Disable formula extraction.")
    parser.add_argument("--disable-table", action="store_true", help="Disable table extraction.")
    parser.add_argument("--poll-interval", type=int, default=8, help="Batch polling interval in seconds.")
    parser.add_argument("--poll-timeout", type=int, default=7200, help="Batch polling timeout in seconds.")

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
    base = input_dir.rglob("*") if recursive else input_dir.glob("*")
    files = sorted([p for p in base if p.is_file() and p.suffix.lower() == ".pdf"])
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


def _download_bytes_with_curl(url: str, timeout: int = 300) -> bytes:
    cmd = [
        "curl",
        "-fL",
        "-sS",
        "--retry",
        "3",
        "--retry-delay",
        "1",
        "--connect-timeout",
        "20",
        "--max-time",
        str(timeout),
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError("curl is not available for fallback download.") from exc

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(
            f"curl download failed (code={proc.returncode}): {stderr[:400]}"
        )
    return proc.stdout


def download_bytes(url: str, timeout: int = 300) -> bytes:
    last_error: Optional[str] = None
    for attempt in range(1, 5):
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code >= 500:
                raise RuntimeError(f"Download failed {resp.status_code}: {url}")
            if resp.status_code >= 400:
                raise ValueError(f"Download failed {resp.status_code}: {url}")
            return resp.content
        except ValueError:
            raise
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt >= 4:
                break
            time.sleep(min(2 ** (attempt - 1), 8))

    log(f"[DOWNLOAD] requests failed, fallback to curl: {last_error}")
    return _download_bytes_with_curl(url=url, timeout=timeout)


def resolve_output_base(job: FileJob, input_root: Path, output_root: Path) -> Path:
    try:
        relative = job.path.resolve().relative_to(input_root.resolve())
    except Exception:
        relative = Path(job.name)
    return output_root / relative.with_suffix("")


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def extract_zip_to_dir(zip_bytes: bytes, target_dir: Path) -> int:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        members = [info for info in zf.infolist() if not info.is_dir()]
        if not members:
            raise RuntimeError("Empty MinerU result zip.")
        written = 0
        root = target_dir.resolve()
        for info in members:
            rel_name = Path(info.filename)
            output_path = (target_dir / rel_name).resolve()
            if not _is_within(output_path, root):
                raise RuntimeError(f"Unsafe zip path: {info.filename}")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, output_path.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            written += 1
        return written


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
    if args.poll_interval <= 0:
        raise SystemExit("--poll-interval must be > 0")
    if args.poll_timeout <= 0:
        raise SystemExit("--poll-timeout must be > 0")

    output_dir = normalize_path(args.output_dir)
    state_file = normalize_path(args.state_file)
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
            and previous.get("status") == "exported"
            and previous.get("sha256") == sha
        ):
            log(f"[SKIP] {path.name} already exported.")
            continue
        data_id = (
            str(previous.get("data_id") or "").strip()
            if isinstance(previous, dict) and previous.get("sha256") == sha
            else safe_data_id(path, sha)
        )
        jobs.append(FileJob(path=path, name=path.name, sha256=sha, data_id=data_id))

    if not jobs:
        log("Nothing to export.")
        return 0

    mineru_client = MinerUClient(
        token=mineru_token,
        base_url=args.mineru_base_url,
    )

    log(
        f"Prepared {len(jobs)} files for local export. "
        f"MinerU model={args.model_version}. output={output_dir}"
    )

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
                output_base = resolve_output_base(job, input_dir, output_dir)
                extract_dir = output_base.with_name(f"{output_base.name}_extracted")
                if extract_dir.exists() and args.force:
                    shutil.rmtree(extract_dir)
                file_count = extract_zip_to_dir(zip_bytes, extract_dir)

                zip_path = ""
                if args.keep_zip:
                    zip_path_obj = output_base.with_suffix(".zip")
                    zip_path_obj.parent.mkdir(parents=True, exist_ok=True)
                    zip_path_obj.write_bytes(zip_bytes)
                    zip_path = str(zip_path_obj)
                    log(f"[SAVE-ZIP] {job.name} -> {zip_path_obj}")

                update_state_entry(
                    state,
                    job.path,
                    {
                        "status": "exported",
                        "sha256": job.sha256,
                        "batch_id": batch_id,
                        "data_id": job.data_id,
                        "zip_url": zip_url,
                        "zip_path": zip_path,
                        "extract_dir": str(extract_dir),
                        "files_extracted": file_count,
                        "updated_at": int(time.time()),
                    },
                )
                log(f"[EXPORTED] {job.name}: files={file_count} dir={extract_dir}")

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
    exported = 0
    failed = 0
    for job in jobs:
        row = (state.get("files", {}) or {}).get(str(job.path.resolve()), {})
        status = str((row or {}).get("status") or "")
        if status == "exported":
            exported += 1
        elif status == "failed":
            failed += 1

    log("")
    log(f"Finished. total={total}, exported={exported}, failed={failed}, state={state_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

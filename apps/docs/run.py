import os, re, subprocess, sys

requested = "gpt-5.3-codex"
prompt = 'Say exactly this sentence and nothing else: "Hello, this is the answer."'
proc = subprocess.run(
    ["codex", "exec", "--skip-git-repo-check", "-s", "read-only", "-m", requested, prompt],
    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="ignore",
    env={**os.environ, "RUST_LOG": "codex_api::sse::responses=trace"},
)
models = sorted(set(re.findall(r'"model":"([^"]+)"', proc.stderr)))
if not models:
    print(f"no models")
    sys.exit(1)
if set(models) == {requested}:
    print(f"MODEL OK: {requested}")
    sys.exit(0)
print(f"MODEL MISMATCH: requested={requested} actual={','.join(models)}")
sys.exit(1)

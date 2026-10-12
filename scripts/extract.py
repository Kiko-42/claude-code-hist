#!/usr/bin/env python3
"""Print the prompts you typed in a Claude Code session, newest first, each with the reply that followed, as JSON.

Usage: python3 -I extract.py <session>.jsonl [limit]
Output: [{"id","time","prompt","reply"}, ...]  (the prompt-jump mod's register.tsx runs this through $.process.run)
Dropped: sub-agent rows, isMeta rows, tool results, rows starting with "<" (<command-name>, <local-command-caveat>, ...),
         rows holding "Base directory for this skill", [Subagent / [Request interrupted rows, and any non-human origin
         (task notifications and the like).
"""
import json
import sys
from datetime import datetime

PROMPT_MAX = 1500
REPLY_MAX = 4000
NOISE_SUBSTR = ("<command-name>", "Base directory for this skill", "<local-command-caveat>")
NOISE_PREFIX = ("<", "[Subagent", "[Request interrupted")


def text_of(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return ""


def is_noise(t):
    return t.startswith(NOISE_PREFIX) or any(s in t for s in NOISE_SUBSTR)


def when_of(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
    except (ValueError, AttributeError):
        return None


def fmt(when, today):
    if when is None:
        return "--:--"
    return f"{when:%H:%M}" if when.date() == today else f"{when:%m/%d %H:%M}"


def load(path):
    turns = []  # (role, uuid, when, text)
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            role = d.get("type")
            if role not in ("user", "assistant") or d.get("isSidechain") or d.get("isMeta"):
                continue
            t = text_of(d.get("message") or {}).strip()
            if not t:
                continue
            if role == "user":
                origin = d.get("origin")
                if isinstance(origin, dict) and origin.get("kind") not in (None, "human"):
                    continue
                if is_noise(t):
                    continue
            turns.append((role, d.get("uuid") or "", when_of(d.get("timestamp", "")), t))
    return turns


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    turns = load(sys.argv[1])
    today = datetime.now().astimezone().date()
    items = []
    for i, (role, uuid, when, t) in enumerate(turns):
        if role != "user":
            continue
        reply = []
        for r2, _, _, t2 in turns[i + 1:]:
            if r2 == "user":
                break
            reply.append(t2)
        reply_text = "\n\n".join(reply)
        if len(reply_text) > REPLY_MAX:
            reply_text = reply_text[:REPLY_MAX] + "\n\n… (truncated)"
        items.append({
            "id": uuid,
            "time": fmt(when, today),
            "prompt": t if len(t) <= PROMPT_MAX else t[:PROMPT_MAX] + "…",
            "reply": reply_text,
        })
    items.reverse()
    json.dump(items[:limit], sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()

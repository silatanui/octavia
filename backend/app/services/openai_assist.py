"""OpenAI-backed management report analysis and plant chatbot."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from app.core.config import get_settings

SYSTEM_PLANT = (
    "You are Octavia, an MES analyst for Tanui Plastic Plant (injection molding / outdoor accessories). "
    "Be concise, practical, and data-grounded. Prefer short bullets. "
    "Do not invent sensors or events not present in the provided metrics. "
    "When recommending actions, keep them shop-floor realistic (tooling, material, staffing, maintenance). "
    "Never use em dashes or en dashes; use commas, periods, or a plain hyphen with spaces if needed."
)


def _api_key() -> str:
    return (get_settings().openai_api_key or "").strip()


def openai_configured() -> bool:
    return bool(_api_key())


def _chat_completion(messages: list[dict[str, str]], *, temperature: float = 0.35) -> str:
    key = _api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    settings = get_settings()
    payload = json.dumps(
        {
            "model": settings.openai_model or "gpt-4o-mini",
            "temperature": temperature,
            "messages": messages,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {body[:240]}") from exc
    text = str(data["choices"][0]["message"]["content"]).strip()
    return text.replace("\u2014", " - ").replace("\u2013", " - ")


def _compact_report(report: dict[str, Any]) -> dict[str, Any]:
    kpis = report.get("kpis") or {}
    pareto = (report.get("downtime_pareto") or {}).get("rows") or []
    compare = report.get("machine_compare") or []
    losses = report.get("top_losses") or []
    return {
        "scope": report.get("scope_label"),
        "filters": report.get("filters_echo"),
        "machine_count": report.get("machine_count"),
        "kpis": {
            "oee": kpis.get("oee"),
            "availability": kpis.get("availability"),
            "performance": kpis.get("performance"),
            "quality": kpis.get("quality"),
            "achievement": kpis.get("achievement"),
            "downtime_minutes": kpis.get("downtime_minutes"),
            "good_units": kpis.get("good_units"),
            "scrap_units": kpis.get("scrap_units"),
            "total_units": kpis.get("total_units"),
            "delta_oee": kpis.get("delta_oee"),
            "delta_downtime_minutes": kpis.get("delta_downtime_minutes"),
            "delta_good_units": kpis.get("delta_good_units"),
        },
        "top_downtime": [
            {
                "reason": r.get("reason"),
                "minutes": r.get("minutes"),
                "count": r.get("count"),
                "pct_of_downtime": r.get("pct_of_downtime"),
            }
            for r in pareto[:8]
        ],
        "top_losses": losses[:6],
        "machines": [
            {
                "code": m.get("machine_code"),
                "oee": m.get("oee"),
                "availability": m.get("availability"),
                "output": m.get("output"),
                "scrap": m.get("scrap"),
                "downtime_minutes": m.get("downtime_minutes"),
            }
            for m in compare[:12]
        ],
        "quality_mix": report.get("quality_mix"),
    }


def _fallback_analysis(report: dict[str, Any]) -> dict[str, Any]:
    k = report.get("kpis") or {}
    scope = report.get("scope_label") or "Plant"
    oee = k.get("oee")
    avail = k.get("availability")
    perf = k.get("performance")
    qual = k.get("quality")
    dt = k.get("downtime_minutes") or 0
    good = k.get("good_units") or 0
    scrap = k.get("scrap_units") or 0
    delta_oee = k.get("delta_oee")
    pareto = (report.get("downtime_pareto") or {}).get("rows") or []
    compare = report.get("machine_compare") or []

    narrative = (
        f"{scope}: OEE {oee if oee is not None else 'n/a'}% "
        f"(A {avail if avail is not None else 'n/a'}% · P {perf if perf is not None else 'n/a'}% · "
        f"Q {qual if qual is not None else 'n/a'}%). "
        f"Good output {int(good):,}, scrap {int(scrap):,}, downtime {dt:.0f} min."
    )
    if delta_oee is not None:
        sign = "+" if delta_oee >= 0 else ""
        narrative += f" OEE {sign}{delta_oee:.1f}pp vs prior window."

    findings: list[dict[str, str]] = []
    if pareto:
        top = pareto[0]
        findings.append(
            {
                "severity": "high",
                "title": f"Top loss: {top.get('reason')}",
                "detail": (
                    f"{top.get('duration_label') or top.get('minutes')} · "
                    f"{top.get('count')} stops · {top.get('pct_of_downtime')}% of downtime."
                ),
            }
        )
    if compare:
        weak = min(compare, key=lambda m: (m.get("oee") is None, m.get("oee") or 0))
        strong = max(compare, key=lambda m: (m.get("oee") is None, m.get("oee") or 0))
        findings.append(
            {
                "severity": "medium",
                "title": f"Machine spread: {strong.get('machine_code')} vs {weak.get('machine_code')}",
                "detail": (
                    f"Best OEE {strong.get('oee')}% on {strong.get('machine_code')}; "
                    f"lowest {weak.get('oee')}% on {weak.get('machine_code')} "
                    f"({weak.get('downtime_minutes')} min downtime)."
                ),
            }
        )
    if scrap and good and scrap / max(good + scrap, 1) > 0.03:
        findings.append(
            {
                "severity": "medium",
                "title": "Scrap share elevated",
                "detail": f"Scrap is {scrap:,.0f} of {good + scrap:,.0f} units in this window.",
            }
        )

    actions = [
        "Review top Pareto reasons with maintenance and area leads in the next standup.",
        "Compare low-OEE presses against sister machines running the same product.",
        "Confirm scrap spikes align with colour/mould changes or material lots.",
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": "fallback",
        "executive_summary": narrative,
        "findings": findings,
        "actions": actions,
        "disclaimer": "Heuristic summary (OpenAI key not configured). Add OPENAI_API_KEY for LLM analysis.",
    }


def analyze_management_report(report: dict[str, Any]) -> dict[str, Any]:
    if not openai_configured():
        return _fallback_analysis(report)

    compact = _compact_report(report)
    prompt = (
        "Analyze this management report JSON for Tanui Plastic Plant. "
        "Return ONLY valid JSON with keys: "
        "executive_summary (string, 2-4 sentences), "
        "findings (array of {severity: low|medium|high, title, detail}), "
        "actions (array of 3-5 short strings). "
        "Focus on OEE drivers, downtime Pareto, machine outliers, and quality/scrap.\n\n"
        f"{json.dumps(compact, default=str)}"
    )
    try:
        raw = _chat_completion(
            [
                {"role": "system", "content": SYSTEM_PLANT + " Always reply with JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        parsed = json.loads(text)
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "provider": "openai",
            "executive_summary": str(parsed.get("executive_summary") or raw),
            "findings": parsed.get("findings") or [],
            "actions": parsed.get("actions") or [],
            "disclaimer": "Generated with OpenAI from the current report filters and KPIs.",
        }
    except Exception as exc:  # noqa: BLE001
        fallback = _fallback_analysis(report)
        fallback["disclaimer"] = f"OpenAI request failed ({exc}); showing heuristic summary."
        fallback["provider"] = "fallback"
        return fallback


def chat_with_context(
    *,
    message: str,
    history: list[dict[str, str]] | None = None,
    report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    history = history or []
    if not openai_configured():
        tip = (
            "AI chat needs OPENAI_API_KEY on the backend. "
            "Until then: open Reports, filter by machine/line, and use the AI Analysis panel "
            "heuristics for OEE, downtime Pareto, and scrap."
        )
        if report:
            k = report.get("kpis") or {}
            tip = (
                f"Without OpenAI I can only echo local KPIs for {report.get('scope_label')}: "
                f"OEE {k.get('oee')}%, downtime {k.get('downtime_minutes')} min, "
                f"good {k.get('good_units')}. Configure OPENAI_API_KEY to chat fully.\n\n"
                f"Your question: {message}"
            )
        return {
            "reply": tip,
            "provider": "fallback",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PLANT}]
    if report:
        messages.append(
            {
                "role": "system",
                "content": "Current management report context (JSON):\n"
                + json.dumps(_compact_report(report), default=str),
            }
        )
    for turn in history[-8:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content[:4000]})
    messages.append({"role": "user", "content": message.strip()[:4000]})

    try:
        reply = _chat_completion(messages, temperature=0.4)
        return {
            "reply": reply,
            "provider": "openai",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "reply": f"Chat failed talking to OpenAI ({exc}). Check the API key and network.",
            "provider": "error",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

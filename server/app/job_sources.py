import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


LOGGER = logging.getLogger("iconnect.job_sources")
CACHE_SECONDS = 300
REQUEST_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
_cache_lock = threading.Lock()
_source_cache: Dict[Tuple[str, str], Tuple[float, List[Dict[str, Any]]]] = {}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(value: Any, limit: int = 5000) -> str:
    if not isinstance(value, str):
        return ""
    parser = _TextExtractor()
    parser.feed(unescape(unescape(value)))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()[:limit]


def _request_json(url: str) -> Dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "iConnect-JobHub/1.0"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError("The job provider returned HTTP {}.".format(response.status))
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("The job provider response exceeded the size limit.")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("The job provider returned an invalid response.")
    return data


def _valid_external_url(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc:
        return None
    return value


def _workplace_type(location: str, remote: bool = False, hybrid: bool = False) -> str:
    if remote or "remote" in location.lower():
        return "remote"
    if hybrid or "hybrid" in location.lower():
        return "hybrid"
    return "onsite"


def _greenhouse_jobs(board_token: str) -> List[Dict[str, Any]]:
    url = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true".format(
        quote(board_token, safe="")
    )
    data = _request_json(url)
    jobs = data.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("Greenhouse returned an invalid jobs list.")
    results = []
    for item in jobs:
        if not isinstance(item, dict) or not item.get("id") or not item.get("title"):
            continue
        location_data = item.get("location") or {}
        location = location_data.get("name", "") if isinstance(location_data, dict) else ""
        description = _plain_text(item.get("content"))
        external_url = _valid_external_url(item.get("absolute_url"))
        if not external_url:
            continue
        title = str(item["title"])[:120]
        company = str(item.get("company_name") or board_token)[:120]
        results.append({
            "id": "greenhouse:{}:{}".format(board_token, item["id"]),
            "source": "Greenhouse",
            "externalUrl": external_url,
            "title": title,
            "company": company,
            "companyImageUrl": None,
            "location": str(location)[:160] or "Location not specified",
            "employmentType": "See employer listing",
            "workplaceType": _workplace_type(str(location)),
            "summary": description[:240] or "View the full role details on the employer's careers site.",
            "description": description or "Open the employer's careers site for full role details.",
            "createdAt": str(item.get("updated_at") or datetime.now(timezone.utc).isoformat()),
            "poster": None,
            "isSaved": False,
            "appliedByMe": False,
            "isOwner": False,
            "applicationCount": 0,
            "applicationStatus": None,
            "applicationCoverLetter": None,
        })
    return results


def _smartrecruiters_jobs(company_id: str) -> List[Dict[str, Any]]:
    url = "https://api.smartrecruiters.com/v1/companies/{}/postings?limit=100".format(
        quote(company_id, safe="")
    )
    data = _request_json(url)
    postings = data.get("content")
    if not isinstance(postings, list):
        raise ValueError("SmartRecruiters returned an invalid postings list.")
    results = []
    for item in postings:
        if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
            continue
        company_data = item.get("company") or {}
        location_data = item.get("location") or {}
        if not isinstance(company_data, dict) or not isinstance(location_data, dict):
            continue
        company_identifier = str(company_data.get("identifier") or company_id)
        posting_id = quote(str(item["id"]), safe="")
        company_path = quote(company_identifier, safe="")
        external_url = _valid_external_url(
            "https://jobs.smartrecruiters.com/{}/{}".format(company_path, posting_id)
        )
        if not external_url:
            continue
        location = str(location_data.get("fullLocation") or "Location not specified")[:160]
        employment_data = item.get("typeOfEmployment") or {}
        employment_type = (
            str(employment_data.get("label"))
            if isinstance(employment_data, dict) and employment_data.get("label")
            else "See employer listing"
        )
        description = "Open the employer's SmartRecruiters posting for the full role details."
        details = [
            str(value.get("label"))
            for value in (item.get("department"), item.get("industry"), item.get("function"))
            if isinstance(value, dict) and value.get("label")
        ]
        results.append({
            "id": "smartrecruiters:{}:{}".format(company_id, item["id"]),
            "source": "SmartRecruiters",
            "externalUrl": external_url,
            "title": str(item["name"])[:120],
            "company": str(company_data.get("name") or company_id)[:120],
            "companyImageUrl": None,
            "location": location,
            "employmentType": employment_type[:80],
            "workplaceType": _workplace_type(
                location,
                remote=bool(location_data.get("remote")),
                hybrid=bool(location_data.get("hybrid")),
            ),
            "summary": " · ".join(details)[:240] or description,
            "description": description,
            "createdAt": str(item.get("releasedDate") or datetime.now(timezone.utc).isoformat()),
            "poster": None,
            "isSaved": False,
            "appliedByMe": False,
            "isOwner": False,
            "applicationCount": 0,
            "applicationStatus": None,
            "applicationCoverLetter": None,
        })
    return results


def _fetch_cached(provider: str, source_id: str) -> List[Dict[str, Any]]:
    key = (provider, source_id)
    now = time.monotonic()
    with _cache_lock:
        cached = _source_cache.get(key)
        if cached and cached[0] > now:
            return [dict(job) for job in cached[1]]
    jobs = _greenhouse_jobs(source_id) if provider == "Greenhouse" else _smartrecruiters_jobs(source_id)
    with _cache_lock:
        _source_cache[key] = (time.monotonic() + CACHE_SECONDS, jobs)
        expired = [cache_key for cache_key, entry in _source_cache.items() if entry[0] <= now]
        for cache_key in expired:
            _source_cache.pop(cache_key, None)
    return [dict(job) for job in jobs]


def fetch_external_jobs(
    greenhouse_board_tokens: Tuple[str, ...],
    smartrecruiters_company_ids: Tuple[str, ...],
    query: str = "",
    location: str = "",
    workplace_type: str = "",
    limit: int = 50,
) -> Dict[str, Any]:
    sources = (
        [("Greenhouse", source_id) for source_id in greenhouse_board_tokens]
        + [("SmartRecruiters", source_id) for source_id in smartrecruiters_company_ids]
    )
    if not sources:
        return {"jobs": [], "warnings": [], "enabled": False}

    jobs: List[Dict[str, Any]] = []
    warnings = []
    with ThreadPoolExecutor(max_workers=min(8, len(sources))) as executor:
        futures = {
            executor.submit(_fetch_cached, provider, source_id): (provider, source_id)
            for provider, source_id in sources
        }
        for future in as_completed(futures):
            provider, source_id = futures[future]
            try:
                jobs.extend(future.result())
            except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, UnicodeDecodeError) as error:
                LOGGER.warning("%s job feed %s failed: %s", provider, source_id, error)
                warnings.append("{} feed ({}) is temporarily unavailable.".format(provider, source_id))

    normalized_query = query.strip().casefold()
    normalized_location = location.strip().casefold()
    results = [
        job for job in jobs
        if (not normalized_query or normalized_query in " ".join((
            job["title"], job["company"], job["summary"], job["description"]
        )).casefold())
        and (not normalized_location or normalized_location in job["location"].casefold())
        and (not workplace_type or job["workplaceType"] == workplace_type)
    ]
    results.sort(key=lambda job: job["createdAt"], reverse=True)
    return {
        "jobs": results[:limit],
        "warnings": warnings,
        "enabled": True,
    }

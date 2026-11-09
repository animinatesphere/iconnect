"""Deriv Options API connection for the iTrade desk.

Public market data needs no login. Trading uses a Personal Access Token (PAT)
plus Deriv-App-ID to get a one-time WebSocket URL for one account.

Safety: this module only trades DEMO accounts. A real account or a real
WebSocket URL is refused, whatever the configuration says.
"""

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

LOGGER = logging.getLogger("iconnect.deriv")

REST_BASE = "https://api.derivws.com"
PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public"
USER_AGENT = "iConnect-API/1.0"

# iTrade pairs that Deriv offers as Multipliers (checked against active_symbols
# and contracts_for). GBP/CAD has no multipliers and CAD/JPY is not listed.
DERIV_SYMBOLS: Dict[str, str] = {
    "EUR/USD": "frxEURUSD",
    "GBP/USD": "frxGBPUSD",
    "USD/JPY": "frxUSDJPY",
    "USD/CAD": "frxUSDCAD",
    "EUR/GBP": "frxEURGBP",
    "EUR/JPY": "frxEURJPY",
    "EUR/CAD": "frxEURCAD",
    "GBP/JPY": "frxGBPJPY",
}
# Checked live against Deriv FX Multipliers: these multipliers, stake $1–$500.
MULTIPLIERS = (50, 100, 150, 250, 500)
MIN_STAKE = 1.0
MAX_STAKE = 500.0
COMMISSION_CACHE_SECONDS = 3600
QUOTE_CACHE_SECONDS = 2.0


class DerivError(Exception):
    def __init__(self, message: str, code: str = "deriv_error"):
        super().__init__(message)
        self.message = message
        self.code = code


def _connect(url: str) -> Any:
    from websockets.sync.client import connect

    return connect(url, open_timeout=10, close_timeout=3, user_agent_header=USER_AGENT)


class _Socket:
    def __init__(self, ws: Any):
        self.ws = ws
        self.req_id = 0

    def call(self, message: Dict[str, Any], timeout: float = 12.0) -> Dict[str, Any]:
        self.req_id += 1
        payload = dict(message, req_id=self.req_id)
        self.ws.send(json.dumps(payload))
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise DerivError("Deriv did not respond in time.", "deriv_timeout")
            response = json.loads(self.ws.recv(timeout=remaining))
            if response.get("req_id") != self.req_id:
                continue
            error = response.get("error")
            if error:
                raise DerivError(str(error.get("message") or "Deriv rejected the request."), str(error.get("code") or "deriv_error"))
            return response


class DerivMarketData:
    """Latest bid/ask from the public gateway, cached briefly and shared by everyone."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._fetched_at: Optional[float] = None
        self.last_error: Optional[str] = None
        self.last_success = 0.0
        self._commission: Dict[str, tuple] = {}

    def quotes(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            if self._fetched_at is not None and time.monotonic() - self._fetched_at < QUOTE_CACHE_SECONDS:
                return dict(self._cache)
            fresh: Dict[str, Dict[str, Any]] = {}
            try:
                with _connect(PUBLIC_WS) as ws:
                    socket = _Socket(ws)
                    for pair, symbol in DERIV_SYMBOLS.items():
                        try:
                            tick = socket.call({"ticks": symbol}, timeout=6).get("tick") or {}
                        except DerivError as error:
                            # Market closed or symbol suspended: leave this pair out.
                            LOGGER.info("Deriv tick unavailable for %s: %s", symbol, error.message)
                            continue
                        if tick.get("bid") is None or tick.get("ask") is None:
                            continue
                        fresh[pair] = {
                            "bid": float(tick["bid"]),
                            "ask": float(tick["ask"]),
                            "epoch": int(tick.get("epoch") or time.time()),
                            "source": "deriv",
                        }
                self.last_error = None
                self.last_success = time.time()
            except Exception as error:  # Network failure: keep serving nothing rather than stale prices.
                LOGGER.warning("Deriv market data failed: %s", error)
                self.last_error = str(error)[:200]
                fresh = {}
            self._cache = fresh
            self._fetched_at = time.monotonic()
            return dict(fresh)

    def quote(self, pair: str) -> Optional[Dict[str, Any]]:
        return self.quotes().get(pair)

    def commission_rate(self, pair: str) -> Optional[float]:
        """Deriv's Multiplier commission as a fraction of the USD position size."""
        symbol = DERIV_SYMBOLS.get(pair)
        if not symbol:
            return None
        cached = self._commission.get(pair)
        if cached and time.monotonic() - cached[1] < COMMISSION_CACHE_SECONDS:
            return cached[0]
        try:
            with _connect(PUBLIC_WS) as ws:
                proposal = _Socket(ws).call({
                    "proposal": 1, "amount": 100, "basis": "stake", "contract_type": "MULTUP",
                    "currency": "USD", "multiplier": 100, "underlying_symbol": symbol,
                })["proposal"]
            rate = float(proposal.get("commission") or 0) / 10000.0
        except Exception as error:
            LOGGER.warning("Deriv commission lookup failed for %s: %s", symbol, error)
            return cached[0] if cached else None
        self._commission[pair] = (rate, time.monotonic())
        return rate

    def state(self) -> str:
        if self.last_success and time.time() - self.last_success < 120:
            return "GOOD"
        return "DISCONNECTED" if self.last_error or not self.last_success else "STALE"


class DerivAccount:
    """The owner's Deriv demo account, reached with a PAT and app ID from the server environment."""

    def __init__(self, app_id: str, token: str, account_id: str = "") -> None:
        self.app_id = app_id
        self.token = token
        self.preferred_account_id = account_id
        self._lock = threading.Lock()
        self._account: Optional[Dict[str, Any]] = None
        self._account_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.app_id and self.token)

    def _rest(self, method: str, path: str) -> Dict[str, Any]:
        request = urllib.request.Request(
            REST_BASE + path,
            data=b"" if method == "POST" else None,
            method=method,
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer " + self.token,
                "Deriv-App-ID": self.app_id,
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read(1024 * 1024) or b"{}")
        except urllib.error.HTTPError as error:
            detail = ""
            try:
                body = json.loads(error.read(64 * 1024) or b"{}")
                errors = body.get("errors") or body.get("error") or body
                if isinstance(errors, list) and errors:
                    errors = errors[0]
                if isinstance(errors, dict):
                    detail = str(errors.get("message") or errors.get("detail") or "")
            except (ValueError, OSError):
                pass
            if error.code in (401, 403):
                raise DerivError("Deriv rejected the API token or app ID ({}). {}".format(error.code, detail).strip(), "deriv_auth_failed")
            raise DerivError("Deriv request failed (HTTP {}). {}".format(error.code, detail).strip())
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            raise DerivError("Could not reach Deriv: {}".format(error))

    def account(self, refresh: bool = False) -> Dict[str, Any]:
        with self._lock:
            if self._account and not refresh and time.monotonic() - self._account_at < 30:
                return self._account
            accounts: List[Dict[str, Any]] = self._rest("GET", "/trading/v1/options/accounts").get("data") or []
            if self.preferred_account_id:
                chosen = next((item for item in accounts if item.get("account_id") == self.preferred_account_id), None)
                if not chosen:
                    raise DerivError("DERIV_ACCOUNT_ID was not found on this token.", "deriv_account_missing")
            else:
                chosen = next((item for item in accounts if item.get("account_type") == "demo" and item.get("status", "active") == "active"), None)
                if not chosen:
                    raise DerivError("No active Deriv demo account was found on this token.", "deriv_account_missing")
            if chosen.get("account_type") != "demo":
                raise DerivError("Only Deriv demo accounts can be used. Real-money trading is disabled.", "deriv_real_refused")
            self._account = chosen
            self._account_at = time.monotonic()
            return chosen

    @contextmanager
    def session(self) -> Iterator[_Socket]:
        account = self.account()
        result = self._rest("POST", "/trading/v1/options/accounts/{}/otp".format(urllib.parse.quote(account["account_id"], safe="")))
        url = ((result.get("data") or {}).get("url")) or ""
        if not url.startswith("wss://") or "/ws/demo" not in urllib.parse.urlsplit(url).path:
            raise DerivError("Deriv returned a non-demo trading connection. Refusing to trade.", "deriv_real_refused")
        with _connect(url) as ws:
            yield _Socket(ws)

    def balance(self) -> Dict[str, Any]:
        with self.session() as socket:
            data = socket.call({"balance": 1}).get("balance") or {}
        return {"balance": float(data.get("balance") or 0), "currency": data.get("currency")}

    def buy_multiplier(self, symbol: str, side: str, stake: float, multiplier: int,
                       stop_loss: float, take_profit: float, currency: str) -> Dict[str, Any]:
        """Quote and buy one Multiplier contract with stop-loss and take-profit attached."""
        contract_type = "MULTUP" if side == "buy" else "MULTDOWN"
        with self.session() as socket:
            proposal = socket.call({
                "proposal": 1,
                "amount": stake,
                "basis": "stake",
                "contract_type": contract_type,
                "currency": currency,
                "multiplier": multiplier,
                "underlying_symbol": symbol,
                "limit_order": {"stop_loss": stop_loss, "take_profit": take_profit},
            })["proposal"]
            commission = float(proposal.get("commission") or 0)
            receipt = socket.call({"buy": proposal["id"], "price": float(proposal.get("ask_price") or stake)})["buy"]
        return {"proposal": proposal, "commission": commission, "receipt": receipt}

    def quote_multiplier(self, symbol: str, side: str, stake: float, multiplier: int,
                         stop_loss: float, take_profit: float, currency: str) -> Dict[str, Any]:
        contract_type = "MULTUP" if side == "buy" else "MULTDOWN"
        with self.session() as socket:
            return socket.call({
                "proposal": 1,
                "amount": stake,
                "basis": "stake",
                "contract_type": contract_type,
                "currency": currency,
                "multiplier": multiplier,
                "underlying_symbol": symbol,
                "limit_order": {"stop_loss": stop_loss, "take_profit": take_profit},
            })["proposal"]

    def open_contracts(self, contract_ids: List[int]) -> Dict[int, Dict[str, Any]]:
        if not contract_ids:
            return {}
        result: Dict[int, Dict[str, Any]] = {}
        with self.session() as socket:
            for contract_id in contract_ids:
                try:
                    result[contract_id] = socket.call({"proposal_open_contract": 1, "contract_id": contract_id}).get("proposal_open_contract") or {}
                except DerivError as error:
                    LOGGER.warning("Deriv contract %s lookup failed: %s", contract_id, error.message)
        return result

    def sell(self, contract_id: int) -> Dict[str, Any]:
        with self.session() as socket:
            receipt = socket.call({"sell": contract_id, "price": 0})["sell"]
            detail = socket.call({"proposal_open_contract": 1, "contract_id": contract_id}).get("proposal_open_contract") or {}
        return {"receipt": receipt, "contract": detail}


def plan_multiplier_order(notional_usd: float, entry: float, stop: float, target: float) -> List[Dict[str, float]]:
    """Candidate (multiplier, stake, stop_loss, take_profit) in USD, lowest leverage first.

    A Multiplier's profit is stake x multiplier x (price change / entry), so the
    stake times the multiplier equals the drafted position's USD notional.
    """
    stop_fraction = abs(entry - stop) / entry
    target_fraction = abs(target - entry) / entry
    stop_loss = round(notional_usd * stop_fraction, 2)
    take_profit = round(notional_usd * target_fraction, 2)
    candidates = []
    for multiplier in MULTIPLIERS:
        stake = round(notional_usd / multiplier, 2)
        # Deriv closes the trade at a full stake loss, so the stop must sit well inside it.
        if stake < MIN_STAKE or stake > MAX_STAKE or stop_loss >= stake * 0.9:
            continue
        candidates.append({"multiplier": multiplier, "stake": stake, "stop_loss": stop_loss, "take_profit": take_profit})
    return candidates

from __future__ import annotations

import json
import os
import pickle
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from robinhoodService import fetch_positions_snapshot


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
STATE_FILE = DATA_DIR / "robinhood-auth-state.json"
load_dotenv(BACKEND_DIR / ".env", override=False)

LOGIN_URL = "https://api.robinhood.com/oauth2/token/"
PATHFINDER_MACHINE_URL = "https://api.robinhood.com/pathfinder/user_machine/"

SESSION_HEADERS = {
    "Accept": "*/*",
    "Accept-Encoding": "gzip,deflate,br",
    "Accept-Language": "en-US,en;q=1",
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    "X-Robinhood-API-Version": "1.431.4",
    "Connection": "keep-alive",
    "User-Agent": "*",
}


def _require_authentication_module() -> Any:
    from robin_stocks.robinhood import authentication

    return authentication


def _require_pyotp() -> Any:
    import pyotp

    return pyotp


def _trim(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _json_response(data: Any) -> Any:
    if isinstance(data, (dict, list)):
        return data
    return {}


def _cookie_dict_from_session(session: requests.Session) -> dict[str, str]:
    return requests.utils.dict_from_cookiejar(session.cookies)


def _apply_cookies(session: requests.Session, cookies: dict[str, str] | None) -> None:
    if not cookies:
        return
    session.cookies = requests.utils.cookiejar_from_dict(cookies)


def _new_session(cookies: dict[str, str] | None = None) -> requests.Session:
    session = requests.Session()
    session.headers.update(SESSION_HEADERS)
    _apply_cookies(session, cookies)
    return session


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _session_path(config: dict[str, Any]) -> Path:
    candidate = _trim(config.get("session_path")) or _trim(os.environ.get("ROBINHOOD_SESSION_PATH"))
    if candidate:
        return Path(candidate)
    return DATA_DIR / "robinhood-session.pickle"


def _session_storage_parts(session_path: Path) -> tuple[str, str]:
    session_path.parent.mkdir(parents=True, exist_ok=True)
    pickle_path = str(session_path.parent)
    pickle_name = session_path.stem
    if pickle_name.startswith("robinhood"):
        pickle_name = pickle_name[len("robinhood") :]
    return pickle_path, pickle_name


def _save_login_pickle(login_data: dict[str, Any], device_token: str, session_path: Path) -> None:
    pickle_path, pickle_name = _session_storage_parts(session_path)
    creds_file = Path(pickle_path) / f"robinhood{pickle_name}.pickle"
    with creds_file.open("wb") as handle:
        pickle.dump(
            {
                "token_type": login_data["token_type"],
                "access_token": login_data["access_token"],
                "refresh_token": login_data["refresh_token"],
                "device_token": device_token,
            },
            handle,
        )


def _state_payload(state: dict[str, Any], session: requests.Session | None = None) -> dict[str, Any]:
    payload = dict(state)
    if session is not None:
        payload["cookies"] = _cookie_dict_from_session(session)
    return payload


def _save_state(state: dict[str, Any], session: requests.Session | None = None) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(_state_payload(state, session), indent=2), encoding="utf-8")


def _load_state() -> dict[str, Any] | None:
    if not STATE_FILE.exists():
        return None
    try:
        raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except Exception:
        return None


def _clear_state() -> None:
    if STATE_FILE.exists():
        STATE_FILE.unlink()


def _device_token() -> str:
    authentication = _require_authentication_module()
    return authentication.generate_device_token()


def _generate_totp(secret: str | None) -> str | None:
    if not secret:
        return None
    pyotp = _require_pyotp()
    return pyotp.TOTP(secret).now()


def _credential_config(config: dict[str, Any]) -> tuple[str, str, str | None]:
    username = _trim(config.get("username")) or _trim(os.environ.get("ROBINHOOD_USERNAME"))
    password = _trim(config.get("password")) or _trim(os.environ.get("ROBINHOOD_PASSWORD"))
    totp_secret = _trim(config.get("totp_secret")) or _trim(os.environ.get("ROBINHOOD_TOTP_SECRET"))
    if not username or not password:
        raise RuntimeError("Missing Robinhood username or password.")
    return username, password, totp_secret


def _build_login_payload(username: str, password: str, device_token: str, mfa_code: str | None = None) -> dict[str, Any]:
    payload = {
        "client_id": "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS",
        "expires_in": 86400,
        "grant_type": "password",
        "password": password,
        "scope": "internal",
        "username": username,
        "device_token": device_token,
        "try_passkeys": False,
        "token_request_path": "/login",
        "create_read_only_secondary_token": True,
    }
    if mfa_code:
        payload["mfa_code"] = mfa_code
    return payload


def _request_json(
    session: requests.Session,
    method: str,
    url: str,
    *,
    data: dict[str, Any] | None = None,
    json_payload: dict[str, Any] | None = None,
    timeout: int = 20,
) -> tuple[int, Any]:
    headers: dict[str, str] = {}
    if json_payload is not None:
        headers["Content-Type"] = "application/json"
    elif data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"

    response = session.request(
        method,
        url,
        data=data,
        json=json_payload,
        headers=headers or None,
        timeout=timeout,
    )
    try:
        payload = response.json()
    except Exception:
        payload = {"text": response.text}
    return response.status_code, payload


def _challenge_from_inquiry(data: dict[str, Any]) -> dict[str, Any]:
    challenge = (
        (((data or {}).get("context") or {}).get("sheriff_challenge") or {})
        if isinstance(data, dict)
        else {}
    )
    return {
        "challenge_id": challenge.get("id"),
        "challenge_type": challenge.get("type"),
        "challenge_status": challenge.get("status"),
    }


def _workflow_status(data: dict[str, Any]) -> str | None:
    if not isinstance(data, dict):
        return None
    result = ((data.get("type_context") or {}).get("result"))
    if result:
        return str(result)
    workflow = ((data.get("verification_workflow") or {}).get("workflow_status"))
    return str(workflow) if workflow else None


def _inquiry_url(machine_id: str) -> str:
    return f"https://api.robinhood.com/pathfinder/inquiries/{machine_id}/user_view/"


def _prompt_status_url(challenge_id: str) -> str:
    return f"https://api.robinhood.com/push/{challenge_id}/get_prompts_status/"


def _challenge_respond_url(challenge_id: str) -> str:
    return f"https://api.robinhood.com/challenge/{challenge_id}/respond/"


def _challenge_message(challenge_type: str | None, challenge_status: str | None) -> str:
    if challenge_type == "prompt":
        return "Approve the login request in the Robinhood app, then click Check Status."
    if challenge_type in {"sms", "email"}:
        return f"Robinhood issued a {challenge_type.upper()} challenge. Enter the code, then click Verify Code."
    if challenge_status == "validated":
        return "Challenge validated. Click Check Status to finish login."
    return "Robinhood requested additional verification."


def _fetch_snapshot_with_saved_session(config: dict[str, Any]) -> dict[str, Any]:
    username, password, totp_secret = _credential_config(config)
    session_path = _session_path(config)

    keys = [
        "ROBINHOOD_USERNAME",
        "ROBINHOOD_PASSWORD",
        "ROBINHOOD_TOTP_SECRET",
        "ROBINHOOD_SESSION_PATH",
    ]
    previous = {key: os.environ.get(key) for key in keys}
    os.environ["ROBINHOOD_USERNAME"] = username
    os.environ["ROBINHOOD_PASSWORD"] = password
    os.environ["ROBINHOOD_SESSION_PATH"] = str(session_path)
    if totp_secret:
        os.environ["ROBINHOOD_TOTP_SECRET"] = totp_secret
    else:
        os.environ.pop("ROBINHOOD_TOTP_SECRET", None)

    try:
        return fetch_positions_snapshot()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _machine_state_from_workflow(
    session: requests.Session,
    workflow_id: str,
    device_token: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    machine_payload = {"device_id": device_token, "flow": "suv", "input": {"workflow_id": workflow_id}}
    _, machine_data = _request_json(session, "POST", PATHFINDER_MACHINE_URL, json_payload=machine_payload)
    machine_data = _json_response(machine_data)
    machine_id = str(machine_data.get("id") or "").strip()
    if not machine_id:
        raise RuntimeError("Robinhood did not return a verification machine id.")
    _, inquiry = _request_json(session, "GET", _inquiry_url(machine_id))
    inquiry = _json_response(inquiry)
    return machine_id, machine_data, inquiry


def start_login(config: dict[str, Any]) -> dict[str, Any]:
    username, password, totp_secret = _credential_config(config)
    mfa_code = _trim(config.get("mfa_code")) or _generate_totp(totp_secret)
    session_path = _session_path(config)
    session = _new_session()
    device_token = _device_token()

    status_code, data = _request_json(
        session,
        "POST",
        LOGIN_URL,
        data=_build_login_payload(username, password, device_token, mfa_code),
    )
    data = _json_response(data)

    if data.get("access_token"):
        _save_login_pickle(data, device_token, session_path)
        _clear_state()
        snapshot = _fetch_snapshot_with_saved_session(config)
        return {
            "status": "authenticated",
            "message": "Robinhood login succeeded.",
            "snapshot": snapshot,
            "http_status": status_code,
        }

    workflow = _json_response(data.get("verification_workflow"))
    workflow_id = _trim(workflow.get("id"))
    if workflow_id:
        machine_id, _, inquiry = _machine_state_from_workflow(session, workflow_id, device_token)
        challenge = _challenge_from_inquiry(inquiry)
        state = {
            "workflow_id": workflow_id,
            "machine_id": machine_id,
            "device_token": device_token,
            "session_path": str(session_path),
            "created_at": time.time(),
            **challenge,
        }
        _save_state(state, session)
        return {
            "status": "challenge_required",
            "message": _challenge_message(challenge.get("challenge_type"), challenge.get("challenge_status")),
            "http_status": status_code,
            **challenge,
        }

    detail = data.get("detail") or data.get("error") or data.get("message") or data.get("text")
    raise RuntimeError(f"Robinhood login failed: {detail or data!r}")


def _finalize_if_possible(session: requests.Session, state: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    username, password, totp_secret = _credential_config(config)
    session_path = _session_path({"session_path": state.get("session_path") or config.get("session_path")})
    mfa_code = _trim(config.get("mfa_code")) or _generate_totp(totp_secret)

    inquiry_url = _inquiry_url(str(state["machine_id"]))
    _, continue_data = _request_json(
        session,
        "POST",
        inquiry_url,
        json_payload={"sequence": 0, "user_input": {"status": "continue"}},
    )
    continue_data = _json_response(continue_data)
    workflow_status = _workflow_status(continue_data)
    challenge = _challenge_from_inquiry(continue_data)
    if challenge.get("challenge_type"):
        state.update(challenge)
    _save_state(state, session)

    if workflow_status not in {"workflow_status_approved", "approved"}:
        return {
            "status": "challenge_required",
            "message": _challenge_message(state.get("challenge_type"), state.get("challenge_status")),
            "workflow_status": workflow_status,
            **challenge,
        }

    status_code, login_data = _request_json(
        session,
        "POST",
        LOGIN_URL,
        data=_build_login_payload(username, password, str(state["device_token"]), mfa_code),
    )
    login_data = _json_response(login_data)
    if not login_data.get("access_token"):
        detail = login_data.get("detail") or login_data.get("error") or login_data.get("message") or login_data.get("text")
        raise RuntimeError(f"Robinhood login finalization failed: {detail or login_data!r}")

    _save_login_pickle(login_data, str(state["device_token"]), session_path)
    _clear_state()
    snapshot = _fetch_snapshot_with_saved_session(config)
    return {
        "status": "authenticated",
        "message": "Robinhood login approved.",
        "snapshot": snapshot,
        "http_status": status_code,
    }


def check_login_status(config: dict[str, Any]) -> dict[str, Any]:
    state = _load_state()
    if not state:
        raise RuntimeError("No Robinhood login is in progress.")

    session = _new_session(state.get("cookies"))
    inquiry_url = _inquiry_url(str(state["machine_id"]))
    _, inquiry = _request_json(session, "GET", inquiry_url)
    inquiry = _json_response(inquiry)
    challenge = _challenge_from_inquiry(inquiry)
    if challenge.get("challenge_type"):
        state.update(challenge)

    if state.get("challenge_type") == "prompt" and state.get("challenge_id"):
        _, prompt_data = _request_json(session, "GET", _prompt_status_url(str(state["challenge_id"])))
        prompt_data = _json_response(prompt_data)
        prompt_status = _trim(prompt_data.get("challenge_status"))
        if prompt_status:
            state["challenge_status"] = prompt_status

    _save_state(state, session)
    if state.get("challenge_status") == "validated":
        return _finalize_if_possible(session, state, config)

    workflow_status = _workflow_status(inquiry)
    if workflow_status in {"workflow_status_approved", "approved"}:
        return _finalize_if_possible(session, state, config)

    return {
        "status": "challenge_required",
        "message": _challenge_message(state.get("challenge_type"), state.get("challenge_status")),
        "workflow_status": workflow_status,
        "challenge_type": state.get("challenge_type"),
        "challenge_status": state.get("challenge_status"),
    }


def verify_code(config: dict[str, Any]) -> dict[str, Any]:
    code = _trim(config.get("verification_code")) or _trim(config.get("mfa_code"))
    if not code:
        raise RuntimeError("Verification code is required.")

    state = _load_state()
    if not state:
        raise RuntimeError("No Robinhood login is in progress.")
    if not state.get("challenge_id"):
        raise RuntimeError("Robinhood did not expose a challenge id to verify.")

    session = _new_session(state.get("cookies"))
    _, response = _request_json(
        session,
        "POST",
        _challenge_respond_url(str(state["challenge_id"])),
        data={"response": code},
    )
    response = _json_response(response)
    status = _trim(response.get("status"))
    if status and status != "validated":
        detail = response.get("detail") or response.get("error") or response.get("message") or response
        raise RuntimeError(f"Robinhood rejected the verification code: {detail}")

    state["challenge_status"] = status or "validated"
    _save_state(state, session)
    return _finalize_if_possible(session, state, config)


def fetch_positions(config: dict[str, Any]) -> dict[str, Any]:
    snapshot = _fetch_snapshot_with_saved_session(config)
    return {
        "status": "authenticated",
        "message": "Robinhood positions fetched.",
        "snapshot": snapshot,
    }

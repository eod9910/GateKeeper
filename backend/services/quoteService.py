#!/usr/bin/env python3
"""
Quick quote service - fetches current price for one or more symbols,
including option contract premiums.

Usage (stock/futures quotes):
    python quoteService.py AAPL MSFT TSLA
    python quoteService.py MES=F

Usage (option premium quotes - pass JSON via --options flag):
    python quoteService.py --options '[{"symbol":"ATOM","strike":2.5,"expiry":"2026-07-17","type":"call","id":"trade-123"}]'

Output: JSON dict
"""
import json
import sys
import datetime

import math

try:
    import yfinance as yf
except ImportError:
    print(json.dumps({"error": "yfinance not installed"}))
    sys.exit(1)


def _bs_greeks(S, K, T, r, sigma, opt_type="call"):
    """Black-Scholes delta and theta.  T in years, sigma as decimal (0.35 = 35%)."""
    if T <= 0 or sigma <= 0 or S <= 0:
        return {"delta": 0.5 if opt_type == "call" else -0.5, "theta": 0.0}
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    nd1 = 0.5 * (1 + math.erf(d1 / math.sqrt(2)))
    nd2 = 0.5 * (1 + math.erf(d2 / math.sqrt(2)))
    pdf_d1 = math.exp(-0.5 * d1 ** 2) / math.sqrt(2 * math.pi)
    if opt_type == "call":
        delta = nd1
        theta = (-(S * pdf_d1 * sigma) / (2 * math.sqrt(T))
                 - r * K * math.exp(-r * T) * nd2) / 365
    else:
        delta = nd1 - 1
        n_neg_d2 = 1 - nd2
        theta = (-(S * pdf_d1 * sigma) / (2 * math.sqrt(T))
                 + r * K * math.exp(-r * T) * n_neg_d2) / 365
    return {"delta": round(delta, 4), "theta": round(theta, 4)}

def get_quotes(symbols):
    result = {}
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            info = ticker.fast_info
            price = getattr(info, 'last_price', None) or getattr(info, 'previous_close', None)
            prev_close = getattr(info, 'previous_close', None)
            
            if price is None:
                # Fallback: get last bar from 1-day history
                hist = ticker.history(period='1d', interval='1m')
                if len(hist) > 0:
                    price = float(hist['Close'].iloc[-1])
                    if prev_close is None:
                        prev_close = float(hist['Open'].iloc[0])
            
            if price is not None:
                change = (price - prev_close) if prev_close else 0
                change_pct = (change / prev_close * 100) if prev_close else 0
                result[sym] = {
                    "price": round(float(price), 4),
                    "change": round(float(change), 4),
                    "changePct": round(float(change_pct), 2),
                    "prevClose": round(float(prev_close), 4) if prev_close else None
                }
            else:
                result[sym] = {"error": "No price data available"}
        except Exception as e:
            result[sym] = {"error": str(e)}
    return result


def normalize_expiry(expiry_str):
    """Try to parse various expiry formats into YYYY-MM-DD."""
    if not expiry_str:
        return None
    # Already YYYY-MM-DD
    if len(expiry_str) == 10 and expiry_str[4] == '-':
        return expiry_str
    # M/DD or MM/DD (assume current year or next year)
    for fmt in ('%m/%d', '%m/%d/%Y', '%m/%d/%y', '%Y-%m-%d', '%m-%d-%Y'):
        try:
            dt = datetime.datetime.strptime(expiry_str, fmt)
            if dt.year == 1900:  # no year provided
                now = datetime.datetime.now()
                dt = dt.replace(year=now.year)
                if dt < now:
                    dt = dt.replace(year=now.year + 1)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue
    return expiry_str  # Return as-is, let yfinance handle it


def get_option_quotes(option_requests):
    """
    Fetch current option contract premiums from yfinance.
    
    option_requests: list of dicts, each with:
      - symbol: underlying ticker (e.g., "ATOM")
      - strike: strike price (e.g., 2.5)
      - expiry: expiration date (e.g., "2026-07-17" or "7/17")
      - type: "call" or "put"
      - id: trade ID (passed through for matching)
    
    Returns: dict keyed by id with { premium, bid, ask, mark, iv, delta, ... }
    """
    result = {}
    
    # Group by underlying symbol to avoid repeated API calls
    by_symbol = {}
    for req in option_requests:
        sym = req.get('symbol', '')
        if sym not in by_symbol:
            by_symbol[sym] = []
        by_symbol[sym].append(req)
    
    for sym, requests in by_symbol.items():
        try:
            ticker = yf.Ticker(sym)
            try:
                underlying_price = ticker.fast_info.get('lastPrice', 0) or 0
            except Exception:
                underlying_price = 0
            available_expiries = ticker.options  # list of date strings like '2026-07-17'
            
            if not available_expiries:
                for req in requests:
                    result[req['id']] = {"error": f"No options data for {sym}"}
                continue
            
            for req in requests:
                try:
                    trade_id = req['id']
                    strike = float(req.get('strike', 0))
                    expiry_raw = req.get('expiry', '')
                    opt_type = req.get('type', 'call').lower()
                    
                    if not strike or not expiry_raw:
                        result[trade_id] = {"error": "Missing strike or expiry"}
                        continue
                    
                    # Normalize expiry to match yfinance format
                    target_expiry = normalize_expiry(expiry_raw)
                    
                    # Find closest matching expiry in available options
                    matched_expiry = None
                    for avail in available_expiries:
                        if avail == target_expiry:
                            matched_expiry = avail
                            break
                    
                    # If exact match not found, find closest
                    if not matched_expiry:
                        try:
                            target_dt = datetime.datetime.strptime(target_expiry, '%Y-%m-%d')
                            closest = min(available_expiries,
                                          key=lambda x: abs((datetime.datetime.strptime(x, '%Y-%m-%d') - target_dt).days))
                            closest_dt = datetime.datetime.strptime(closest, '%Y-%m-%d')
                            if abs((closest_dt - target_dt).days) <= 21:
                                matched_expiry = closest
                        except:
                            pass
                    
                    if not matched_expiry:
                        result[trade_id] = {"error": f"Expiry {expiry_raw} not found. Available: {', '.join(available_expiries[:5])}"}
                        continue
                    
                    # Fetch the option chain for this expiry
                    chain = ticker.option_chain(matched_expiry)
                    df = chain.calls if opt_type == 'call' else chain.puts
                    
                    if df.empty:
                        result[trade_id] = {"error": f"No {opt_type} data for {matched_expiry}"}
                        continue
                    
                    # Find the row closest to our strike
                    df['strike_diff'] = abs(df['strike'] - strike)
                    closest_row = df.loc[df['strike_diff'].idxmin()]
                    
                    # Only use if strike matches within $0.50
                    if closest_row['strike_diff'] > 0.50:
                        result[trade_id] = {"error": f"Strike ${strike} not found. Closest: ${closest_row['strike']:.2f}"}
                        continue
                    
                    last_price = float(closest_row.get('lastPrice', 0))
                    bid = float(closest_row.get('bid', 0))
                    ask = float(closest_row.get('ask', 0))
                    mark = round((bid + ask) / 2, 4) if (bid + ask) > 0 else last_price
                    iv = float(closest_row.get('impliedVolatility', 0))
                    volume = int(closest_row.get('volume', 0)) if closest_row.get('volume') and str(closest_row.get('volume')) != 'nan' else 0
                    oi = int(closest_row.get('openInterest', 0)) if closest_row.get('openInterest') and str(closest_row.get('openInterest')) != 'nan' else 0
                    
                    greeks = {"delta": 0, "theta": 0}
                    if underlying_price > 0 and iv > 0:
                        matched_strike = float(closest_row['strike'])
                        exp_dt = datetime.datetime.strptime(matched_expiry, '%Y-%m-%d')
                        T = max((exp_dt - datetime.datetime.now()).days, 1) / 365.0
                        bs_iv = max(iv, 0.15) if iv < 0.05 else iv
                        greeks = _bs_greeks(underlying_price, matched_strike, T, 0.05, bs_iv, opt_type)
                        if iv < 0.05:
                            greeks["iv_override"] = True

                    result[trade_id] = {
                        "premium": mark if mark > 0 else last_price,
                        "lastPrice": last_price,
                        "bid": round(bid, 4),
                        "ask": round(ask, 4),
                        "mark": round(mark, 4),
                        "iv": round(iv * 100, 2),
                        "ivRaw": round(iv, 6),
                        "ivOverride": greeks.get("iv_override", False),
                        "delta": greeks["delta"],
                        "theta": greeks["theta"],
                        "volume": volume,
                        "openInterest": oi,
                        "matchedStrike": float(closest_row['strike']),
                        "matchedExpiry": matched_expiry,
                        "underlying": sym,
                        "underlyingPrice": round(underlying_price, 2)
                    }
                    
                except Exception as e:
                    result[req['id']] = {"error": str(e)}
                    
        except Exception as e:
            for req in requests:
                result[req['id']] = {"error": f"Failed to get options for {sym}: {str(e)}"}
    
    return result


def get_option_chain(chain_request):
    """
    Fetch an option chain for one underlying/expiry/type combination.

    chain_request: {
      symbol: "AAPL",
      expiry: "2026-07-17" | "7/17" | "",
      type: "call" | "put",
      maxContracts: 120
    }
    """
    sym = str(chain_request.get('symbol', '') or '').strip().upper()
    opt_type = str(chain_request.get('type', 'call') or 'call').strip().lower()
    expiry_raw = str(chain_request.get('expiry', '') or '').strip()
    max_contracts = int(chain_request.get('maxContracts', 120) or 120)
    max_contracts = max(10, min(max_contracts, 250))

    if not sym:
        return {"error": "Missing symbol"}
    if opt_type not in ('call', 'put'):
        opt_type = 'call'

    try:
        ticker = yf.Ticker(sym)
        info = ticker.fast_info
        underlying_price = getattr(info, 'last_price', None) or getattr(info, 'previous_close', None)
        try:
            underlying_price = float(underlying_price) if underlying_price is not None else 0.0
        except Exception:
            underlying_price = 0.0

        available_expiries = list(ticker.options or [])
        if not available_expiries:
            return {"error": f"No options data for {sym}"}

        matched_expiry = available_expiries[0]
        if expiry_raw:
            target_expiry = normalize_expiry(expiry_raw)
            exact = next((avail for avail in available_expiries if avail == target_expiry), None)
            if exact:
                matched_expiry = exact
            else:
                try:
                    target_dt = datetime.datetime.strptime(target_expiry, '%Y-%m-%d')
                    closest = min(
                        available_expiries,
                        key=lambda x: abs((datetime.datetime.strptime(x, '%Y-%m-%d') - target_dt).days),
                    )
                    closest_dt = datetime.datetime.strptime(closest, '%Y-%m-%d')
                    if abs((closest_dt - target_dt).days) <= 21:
                        matched_expiry = closest
                except Exception:
                    pass

        chain = ticker.option_chain(matched_expiry)
        df = chain.calls if opt_type == 'call' else chain.puts
        if df.empty:
            return {"error": f"No {opt_type} contracts for {matched_expiry}"}

        try:
            anchor = underlying_price if underlying_price > 0 else float(df['strike'].median())
            df = df.assign(_anchor_diff=abs(df['strike'] - anchor))
            df = df.sort_values(['_anchor_diff', 'strike']).head(max_contracts).sort_values('strike')
        except Exception:
            try:
                df = df.sort_values('strike').head(max_contracts)
            except Exception:
                pass

        contracts = []
        for _, row in df.iterrows():
            strike = float(row.get('strike', 0) or 0)
            last_price = float(row.get('lastPrice', 0) or 0)
            bid = float(row.get('bid', 0) or 0)
            ask = float(row.get('ask', 0) or 0)
            mark = round((bid + ask) / 2, 4) if (bid + ask) > 0 else last_price
            iv = float(row.get('impliedVolatility', 0) or 0)
            volume = int(row.get('volume', 0) or 0) if str(row.get('volume', '')) != 'nan' else 0
            oi = int(row.get('openInterest', 0) or 0) if str(row.get('openInterest', '')) != 'nan' else 0
            contracts.append({
                "contractSymbol": str(row.get('contractSymbol', '') or ''),
                "strike": strike,
                "lastPrice": round(last_price, 4),
                "bid": round(bid, 4),
                "ask": round(ask, 4),
                "mark": round(mark, 4),
                "premium": mark if mark > 0 else last_price,
                "iv": round(iv * 100, 2),
                "ivRaw": round(iv, 6),
                "volume": volume,
                "openInterest": oi,
                "inTheMoney": bool(row.get('inTheMoney', False)),
            })

        return {
            "underlying": sym,
            "underlyingPrice": round(underlying_price, 2),
            "type": opt_type,
            "expiries": available_expiries,
            "matchedExpiry": matched_expiry,
            "contracts": contracts,
        }
    except Exception as e:
        return {"error": f"Failed to get option chain for {sym}: {str(e)}"}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbols provided"}))
        sys.exit(1)
    
    # Check for --options flag
    if sys.argv[1] == '--options':
        if len(sys.argv) < 3:
            print(json.dumps({"error": "No options data provided"}))
            sys.exit(1)
        try:
            option_requests = json.loads(sys.argv[2])
            quotes = get_option_quotes(option_requests)
            print(json.dumps(quotes))
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON: {str(e)}"}))
            sys.exit(1)
    elif sys.argv[1] == '--option-chain':
        if len(sys.argv) < 3:
            print(json.dumps({"error": "No option chain request provided"}))
            sys.exit(1)
        try:
            chain_request = json.loads(sys.argv[2])
            chain = get_option_chain(chain_request)
            print(json.dumps(chain))
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON: {str(e)}"}))
            sys.exit(1)
    else:
        symbols = sys.argv[1:]
        quotes = get_quotes(symbols)
        print(json.dumps(quotes))

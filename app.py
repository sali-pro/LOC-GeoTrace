from flask import Flask, render_template, request, jsonify, Response
import sqlite3, json, csv, io, ipaddress, requests
from datetime import datetime, timezone
import phonenumbers
from phonenumbers import carrier, geocoder, timezone as phone_timezone
from phonenumbers.phonenumberutil import number_type, PhoneNumberType

app = Flask(__name__)
DB_PATH = "geotrace.db"
IP_API = "http://ip-api.com/json/{}"


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS investigations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            query TEXT NOT NULL,
            result TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")

def save_result(kind, query, result):
    with db() as conn:
        conn.execute(
            "INSERT INTO investigations(kind, query, result, created_at) VALUES(?,?,?,?)",
            (kind, query, json.dumps(result), datetime.now(timezone.utc).isoformat())
        )

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/ip", methods=["POST"])
def lookup_ip():
    data = request.get_json(silent=True) or {}
    raw = (data.get("ip") or "").strip()

    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return jsonify(error="Enter a valid IPv4 or IPv6 address."), 400

    if not addr.is_global:
        return jsonify(error="For safety and accuracy, LOC only looks up public, globally routable IP addresses."), 400

    try:
        response = requests.get(
            IP_API.format(raw),
            timeout=12,
            headers={"User-Agent": "LOC-GeoTrace/1.0"}
        )
        response.raise_for_status()
        payload = response.json()

        if payload.get("status") != "success":
            return jsonify(
                error=payload.get("message", "The IP intelligence provider could not resolve this address.")
            ), 502

        result = {
            "ip": payload.get("query", raw),
            "type": "IPv4" if addr.version == 4 else "IPv6",
            "continent": None,
            "country": payload.get("country"),
            "country_code": payload.get("countryCode"),
            "region": payload.get("regionName"),
            "city": payload.get("city"),
            "postal": payload.get("zip"),
            "latitude": payload.get("lat"),
            "longitude": payload.get("lon"),
            "timezone": payload.get("timezone"),
            "isp": payload.get("isp"),
            "organization": payload.get("org"),
            "asn": payload.get("as"),
            "domain": None,
            "provider": "ip-api.com",
            "accuracy_note": "Approximate network geolocation. It does not identify a person's exact address or live location. Provider uses HTTP, not HTTPS."
        }

        save_result("IP", raw, result)
        return jsonify(result)

    except requests.RequestException:
        return jsonify(error="Could not reach the IP intelligence provider. Try again later."), 502
    except (ValueError, KeyError):
        return jsonify(error="The provider returned an unexpected response."), 502


@app.route("/api/phone", methods=["POST"])
def lookup_phone():
    data = request.get_json(silent=True) or {}
    raw = (data.get("phone") or "").strip()
    region = (data.get("region") or "").strip().upper() or None
    if not raw:
        return jsonify(error="Enter a phone number, preferably with its country code (for example, +919876543210)."), 400
    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException as exc:
        return jsonify(error=str(exc)), 400
    valid = phonenumbers.is_valid_number(parsed)
    possible = phonenumbers.is_possible_number(parsed)
    type_map = {
        PhoneNumberType.FIXED_LINE: "Fixed line",
        PhoneNumberType.MOBILE: "Mobile",
        PhoneNumberType.FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
        PhoneNumberType.TOLL_FREE: "Toll-free",
        PhoneNumberType.PREMIUM_RATE: "Premium rate",
        PhoneNumberType.SHARED_COST: "Shared cost",
        PhoneNumberType.VOIP: "VoIP",
        PhoneNumberType.PERSONAL_NUMBER: "Personal number",
        PhoneNumberType.PAGER: "Pager",
        PhoneNumberType.UAN: "Universal access number",
        PhoneNumberType.VOICEMAIL: "Voicemail",
        PhoneNumberType.UNKNOWN: "Unknown"
    }
    result = {
        "input": raw,
        "international_format": phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL),
        "national_format": phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL),
        "e164": phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164),
        "country_code": parsed.country_code,
        "national_number": str(parsed.national_number),
        "region": geocoder.description_for_number(parsed, "en") or "Not available",
        "carrier": carrier.name_for_number(parsed, "en") or "Not available",
        "number_type": type_map.get(number_type(parsed), "Unknown"),
        "time_zones": list(phone_timezone.time_zones_for_number(parsed)),
        "possible": possible,
        "valid": valid,
        "note": "This is numbering-plan metadata only. It cannot reveal live GPS location, a home address, or the current physical location of the phone."
    }
    save_result("PHONE", raw, result)
    return jsonify(result)

@app.route("/api/history")
def history():
    with db() as conn:
        rows = conn.execute("SELECT id, kind, query, result, created_at FROM investigations ORDER BY id DESC LIMIT 100").fetchall()
    return jsonify([dict(row) for row in rows])

@app.route("/api/history/<int:item_id>", methods=["DELETE"])
def delete_history(item_id):
    with db() as conn:
        conn.execute("DELETE FROM investigations WHERE id=?", (item_id,))
    return jsonify(ok=True)

@app.route("/api/history/clear", methods=["DELETE"])
def clear_history():
    with db() as conn:
        conn.execute("DELETE FROM investigations")
    return jsonify(ok=True)

@app.route("/api/export/<int:item_id>")
def export_item(item_id):
    with db() as conn:
        row = conn.execute("SELECT * FROM investigations WHERE id=?", (item_id,)).fetchone()
    if not row:
        return jsonify(error="Record not found."), 404
    payload = {"id": row["id"], "kind": row["kind"], "query": row["query"],
               "created_at": row["created_at"], "result": json.loads(row["result"])}
    return Response(json.dumps(payload, indent=2), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment; filename=loc-investigation-{item_id}.json"})

@app.route("/api/export.csv")
def export_csv():
    with db() as conn:
        rows = conn.execute("SELECT id, kind, query, result, created_at FROM investigations ORDER BY id DESC").fetchall()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "kind", "query", "created_at", "result_json"])
    for row in rows:
        writer.writerow([row["id"], row["kind"], row["query"], row["created_at"], row["result"]])
    return Response(output.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=loc-investigations.csv"})

init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

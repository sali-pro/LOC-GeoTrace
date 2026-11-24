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
        return jsonify(error="Enter a phone number with its country code, for example +919876543210."), 400

    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException as exc:
        return jsonify(error=f"Phone number parsing failed: {exc}"), 400

    possible = phonenumbers.is_possible_number(parsed)
    valid = phonenumbers.is_valid_number(parsed)

    region_code = phonenumbers.region_code_for_number(parsed)
    number_region = geocoder.description_for_number(parsed, "en")
    carrier_name = carrier.name_for_number(parsed, "en")

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

    detected_type = type_map.get(number_type(parsed), "Unknown")

    if valid:
        validation_status = "Valid according to numbering-plan metadata"
        confidence = "Metadata-valid"
    elif possible:
        validation_status = "Possible length, but not valid according to current metadata"
        confidence = "Limited"
    else:
        validation_status = "Not possible according to numbering-plan metadata"
        confidence = "Low"

    result = {
        "input": raw,
        "international_format": phonenumbers.format_number(
            parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL
        ),
        "national_format": phonenumbers.format_number(
            parsed, phonenumbers.PhoneNumberFormat.NATIONAL
        ),
        "e164": phonenumbers.format_number(
            parsed, phonenumbers.PhoneNumberFormat.E164
        ),
        "country_code": parsed.country_code,
        "national_number": str(parsed.national_number),
        "region_code": region_code or "Not available",
        "region": number_region or "Not available",
        "carrier": carrier_name or "Not available",
        "carrier_status": (
            "Numbering-plan metadata only; current carrier is not verified"
        ),
        "number_type": detected_type,
        "time_zones": list(phone_timezone.time_zones_for_number(parsed)),
        "possible": possible,
        "valid": valid,
        "validation_status": validation_status,
        "confidence": confidence,
        "verified_by_telecom_operator": False,
        "live_location_available": False,
        "owner_identity_available": False,
        "note": (
            "Results are based on phone numbering-plan metadata. "
            "They do not verify subscription status, ownership, current carrier, "
            "live GPS location, or physical address."
        )
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

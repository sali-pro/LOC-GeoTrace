# LOC — GeoTrace

A local, GUI-first IP and phone-number intelligence dashboard for Parrot OS and other Linux distributions.

## What it does

- **IP intelligence:** looks up public IPv4/IPv6 addresses using ipwho.is and displays approximate network geolocation, ISP/organization, ASN and timezone.
- **Phone intelligence:** validates/parses phone numbers using Google's libphonenumber metadata; displays formatting, numbering region, carrier metadata, number type and possible time zones.
- **Investigation history:** stores lookup results locally in SQLite.
- **Exports:** download an individual investigation as JSON or the full history as CSV.
- **Map:** displays the approximate IP geolocation with Leaflet and OpenStreetMap tiles.

## Important limitations and privacy

- IP geolocation is approximate. VPNs, proxies, mobile networks, corporate gateways and carrier-grade NAT can make it inaccurate. It does not identify a person's exact home address or live position.
- A phone number alone cannot reveal live GPS location or the current physical location of a handset. Carrier and region metadata may be incomplete or outdated.
- IP lookups send the IP address you enter to the external provider **ipwho.is**. Review that provider's privacy policy and terms before use.
- Phone-number parsing runs locally; this app does not send phone numbers to a lookup provider.
- Use only public IPs and phone numbers you own or are authorized to investigate. No covert tracking or access to carrier location systems is provided.

## Install on Parrot OS

Open a terminal in the extracted `LOC_GeoTrace` folder:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open Firefox and visit:

```text
http://127.0.0.1:5000
```

Stop the server with `Ctrl+C` in the terminal.

## Notes

- The app binds to `127.0.0.1` only, so it is intended for local use on your own machine.
- The map requires an internet connection to load Leaflet/OpenStreetMap assets and tiles. Lookup also requires internet.
- Investigation history is stored in `geotrace.db` in the project folder. Delete that file to remove all locally stored history.
- This is an initial functional version, not a forensic attribution tool.

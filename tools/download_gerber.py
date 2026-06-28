"""Download a Gerber archive from PCBWay.

Set PCBWAY_COOKIE only when the chosen download URL requires an authenticated
browser session. Do not commit browser cookies or other credentials.
"""

import os
from pathlib import Path

import requests


DEFAULT_URL = (
    "https://pcb-files.s3.us-west-2.amazonaws.com/gerber/26/05/10/"
    "035530930b1578b5390dc46f08509a040ffdec7e90646.zip"
)
url = os.environ.get("PCBWAY_GERBER_URL", DEFAULT_URL)
cookie = os.environ.get("PCBWAY_COOKIE")
output_path = Path(os.environ.get("PCBWAY_GERBER_OUTPUT", "gerber.zip"))

headers = {"User-Agent": "Mozilla/5.0"}
if cookie:
    headers["Cookie"] = cookie

response = requests.get(url, headers=headers, timeout=30)
response.raise_for_status()
output_path.write_bytes(response.content)
print(f"Downloaded {len(response.content):,} bytes to {output_path}")

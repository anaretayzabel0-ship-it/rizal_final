"""
api/index.py
Single Vercel Python entrypoint (Flask app).

Vercel's current Python runtime expects ONE entrypoint file (app.py, index.py,
server.py, main.py, wsgi.py, or asgi.py) exposing a Flask/FastAPI/Django `app`
variable. All routes are defined inside this one app -- Vercel does not treat
every .py file in /api as its own separate function anymore.

Currently implemented: POST /api/login
(Other endpoints -- register, get_posts, get_barangays, post_comment -- will
be added as additional @app.route(...) functions in this same file.)
"""

import os
import re
import urllib.request
import urllib.error
import urllib.parse
import json

import bcrypt
from flask import Flask, request, jsonify

app = Flask(__name__)

SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://ttsgeniubfkcexitfqsd.supabase.co"
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0c2dlbml1YmZrY2V4aXRmcXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjQzMTEsImV4cCI6MjA5MzU0MDMxMX0.9zmGPUoxRnkRuLsC0-w9C-6p5q034o9-vi_q2i7QUy8"
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def _verify_password(plain_password, hashed_password):
    """
    PHP's password_hash() (PASSWORD_BCRYPT) produces hashes prefixed with $2y$.
    Python's bcrypt library only recognizes $2a$/$2b$/$2x$ prefixes, so we
    normalize $2y$ -> $2b$ before checking. The hash payload itself is
    byte-for-byte compatible between PHP and Python bcrypt implementations.
    """
    normalized = hashed_password
    if normalized.startswith("$2y$"):
        normalized = "$2b$" + normalized[4:]

    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), normalized.encode("utf-8"))
    except ValueError:
        return False


@app.route("/api/login", methods=["GET", "POST", "OPTIONS"])
def login():
    if request.method == "OPTIONS":
        return "", 204

    if request.method == "GET":
        return jsonify({
            "success": True,
            "message": "SK Federation API Endpoint is active. Please send a POST request with authentication credentials to login."
        }), 200

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    # ---- Validate inputs ----
    if not email or not password:
        return jsonify({
            "success": False,
            "message": "Email and password are required."
        }), 400

    if not EMAIL_RE.match(email):
        return jsonify({
            "success": False,
            "message": "Invalid email address."
        }), 400

    # ---- Fetch user by email from Supabase ----
    select_fields = (
        "user_id,first_name,last_name,middle_initial,email,"
        "password,status,position,role_id,barangay_id"
    )
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/users"
        f"?email=eq.{urllib.parse.quote(email)}"
        f"&select={select_fields}"
    )

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError:
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 200:
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500

    users = json.loads(response_body) if response_body else []

    # ---- Check if user exists ----
    if not users:
        return jsonify({
            "success": False,
            "message": "Incorrect email or password."
        }), 401

    user = users[0]

    # ---- Check account status ----
    if user.get("status") == "inactive":
        return jsonify({
            "success": False,
            "message": "Your account has been deactivated. Please contact the SK Admin."
        }), 403

    if user.get("status") == "pending":
        return jsonify({
            "success": False,
            "message": "Your account is pending approval. Please wait for confirmation."
        }), 403

    # ---- Verify password ----
    if not _verify_password(password, user.get("password", "")):
        return jsonify({
            "success": False,
            "message": "Incorrect email or password."
        }), 401

    # ---- Return safe user data (never return password) ----
    return jsonify({
        "success": True,
        "message": "Login successful.",
        "user": {
            "userId": user.get("user_id"),
            "firstName": user.get("first_name"),
            "lastName": user.get("last_name"),
            "middleInitial": user.get("middle_initial"),
            "email": user.get("email"),
            "position": user.get("position"),
            "barangayId": user.get("barangay_id"),
        }
    }), 200


if __name__ == "__main__":
    app.run(debug=True)